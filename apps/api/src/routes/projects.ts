import {
  API_ROUTES,
  CreateProjectBodySchema,
  type ListProjectsResponse,
  type ProjectDetailResponse,
  type ProjectResponse,
} from '@hpe/shared';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../audit.js';
import { accessOwnedProject } from '../auth/access.js';
import { actorLabel, requireUser } from '../auth/principal.js';
import type { AppContext } from '../context.js';
import { assets, projects, prototypeVersions, threadNumberSeq } from '../db/schema.js';
import { toProject, toVersion } from '../dto.js';
import { idParam, parseWith } from '../http.js';
import { gcBlobs } from '../import/pipeline.js';
import { newId } from '../ids.js';

export function registerProjectRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get(API_ROUTES.listProjects.path, async (req): Promise<ListProjectsResponse> => {
    const user = await requireUser(ctx, req);
    const rows = await ctx.db
      .select()
      .from(projects)
      .where(eq(projects.ownerId, user.id))
      .orderBy(desc(projects.createdAt), desc(projects.id));
    return { projects: rows.map(toProject) };
  });

  app.post(API_ROUTES.createProject.path, async (req, reply): Promise<ProjectResponse> => {
    const user = await requireUser(ctx, req);
    const body = parseWith(CreateProjectBodySchema, req.body);
    const id = newId();
    const project = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(projects)
        .values({ id, name: body.name, ownerId: user.id })
        .returning();
      await tx.insert(threadNumberSeq).values({ projectId: id, lastNumber: 0 });
      return row!;
    });
    void reply.code(201);
    return { project: toProject(project) };
  });

  app.get(API_ROUTES.getProject.path, async (req): Promise<ProjectDetailResponse> => {
    const { project } = await accessOwnedProject(ctx, req, idParam(req.params));
    const versions = await ctx.db
      .select()
      .from(prototypeVersions)
      .where(eq(prototypeVersions.projectId, project.id))
      .orderBy(asc(prototypeVersions.number));
    return { project: toProject(project), versions: versions.map(toVersion) };
  });

  app.delete(API_ROUTES.deleteProject.path, async (req) => {
    const { project, principal } = await accessOwnedProject(ctx, req, idParam(req.params));
    const versionIds = (
      await ctx.db
        .select({ id: prototypeVersions.id })
        .from(prototypeVersions)
        .where(eq(prototypeVersions.projectId, project.id))
    ).map((v) => v.id);
    const shas =
      versionIds.length === 0
        ? []
        : (
            await ctx.db
              .selectDistinct({ sha: assets.sha256 })
              .from(assets)
              .where(inArray(assets.versionId, versionIds))
          ).map((r) => r.sha);
    await ctx.db.transaction(async (tx) => {
      await tx.delete(projects).where(eq(projects.id, project.id));
      await writeAudit(tx, {
        actor: actorLabel(principal),
        action: 'project.delete',
        target: project.id,
        meta: { name: project.name, versions: versionIds.length },
      });
    });
    await gcBlobs(ctx, shas);
    return { ok: true };
  });
}
