import {
  API_ROUTES,
  AppError,
  CreateShareLinkBodySchema,
  GuestIdentityBodySchema,
  type CreateShareLinkResponse,
  type GuestIdentityResponse,
  type ShareLinksResponse,
  type ShareResolveResponse,
} from '@hpe/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../audit.js';
import { accessOwnedProject } from '../auth/access.js';
import { signGuestToken, verifyGuestToken } from '../auth/guest.js';
import { actorLabel, getPrincipal, loadShareLink } from '../auth/principal.js';
import type { AppContext } from '../context.js';
import { projects, prototypeVersions, shareLinks } from '../db/schema.js';
import { toProject, toShareLink, toVersion } from '../dto.js';
import { idParam, parseWith } from '../http.js';
import { newId, randomToken, sha256Hex } from '../ids.js';
import { rateLimit, type RateLimiter } from '../plugins/rateLimit.js';

export function registerShareRoutes(app: FastifyInstance, ctx: AppContext, limiter: RateLimiter) {
  app.get(API_ROUTES.listShareLinks.path, async (req): Promise<ShareLinksResponse> => {
    const { project } = await accessOwnedProject(ctx, req, idParam(req.params));
    const rows = await ctx.db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.projectId, project.id))
      .orderBy(desc(shareLinks.createdAt), desc(shareLinks.id));
    return { links: rows.map(toShareLink) };
  });

  app.post(
    API_ROUTES.createShareLink.path,
    async (req, reply): Promise<CreateShareLinkResponse> => {
      const { project, principal } = await accessOwnedProject(ctx, req, idParam(req.params));
      if (principal.kind !== 'user') throw new AppError('FORBIDDEN');
      const body = parseWith(CreateShareLinkBodySchema, req.body);
      let expiresAt: Date | null = null;
      if (body.expiresAt !== undefined) {
        expiresAt = new Date(body.expiresAt);
        if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= ctx.now().getTime()) {
          throw new AppError('BAD_REQUEST', 'expiresAt 必須是未來的有效時間');
        }
      }
      const token = randomToken(32);
      const [row] = await ctx.db
        .insert(shareLinks)
        .values({
          id: newId(),
          projectId: project.id,
          tokenHash: sha256Hex(token),
          role: body.role,
          expiresAt,
          createdBy: principal.user.id,
          createdAt: ctx.now(),
        })
        .returning();
      void reply.code(201);
      return { link: toShareLink(row!), token, url: `${ctx.config.appOrigin}/s/${token}` };
    },
  );

  app.delete(API_ROUTES.revokeShareLink.path, async (req) => {
    const id = idParam(req.params);
    if ((await getPrincipal(ctx, req)).kind === 'anonymous') {
      throw new AppError('UNAUTHENTICATED', '請先登入');
    }
    const [link] = await ctx.db.select().from(shareLinks).where(eq(shareLinks.id, id)).limit(1);
    // 沒有權限與不存在都回 404
    if (!link) throw new AppError('NOT_FOUND');
    const { principal } = await accessOwnedProject(ctx, req, link.projectId);
    const [row] = await ctx.db.transaction(async (tx) => {
      const updated = await tx
        .update(shareLinks)
        .set({ revokedAt: ctx.now() })
        .where(eq(shareLinks.id, link.id))
        .returning();
      if (!link.revokedAt) {
        await writeAudit(tx, {
          actor: actorLabel(principal),
          action: 'share.revoke',
          target: link.id,
          meta: { projectId: link.projectId },
        });
      }
      return updated;
    });
    return { link: toShareLink(row!) };
  });

  app.get(
    API_ROUTES.resolveShare.path,
    { preHandler: rateLimit(limiter, 'shareOpen') },
    async (req): Promise<ShareResolveResponse> => {
      const link = await loadShareLink(ctx, idParam(req.params));
      const [project] = await ctx.db.select().from(projects).where(eq(projects.id, link.projectId));
      if (!project) throw new AppError('NOT_FOUND');
      const versions = await ctx.db
        .select()
        .from(prototypeVersions)
        .where(
          and(
            eq(prototypeVersions.projectId, link.projectId),
            eq(prototypeVersions.status, 'ready'),
          ),
        )
        .orderBy(prototypeVersions.number);
      return { project: toProject(project), role: link.role, versions: versions.map(toVersion) };
    },
  );

  app.post(
    API_ROUTES.guestIdentity.path,
    { preHandler: rateLimit(limiter, 'guestIdentity') },
    async (req): Promise<GuestIdentityResponse> => {
      const link = await loadShareLink(ctx, idParam(req.params));
      const body = parseWith(GuestIdentityBodySchema, req.body);
      let guestId = newId();
      if (body.guestToken) {
        const old = verifyGuestToken(body.guestToken, ctx.config.sessionSecret);
        if (old && old.pid === link.projectId) guestId = old.gid;
      }
      const guestToken = signGuestToken(
        { gid: guestId, name: body.name, pid: link.projectId },
        ctx.config.sessionSecret,
      );
      return { guestToken, guest: { guestId, name: body.name } };
    },
  );
}
