import {
  API_ROUTES,
  AppError,
  CreateCommentBodySchema,
  CreateThreadBodySchema,
  UpdateCommentBodySchema,
  UpdateThreadBodySchema,
  type DeleteCommentResponse,
  type Thread,
  type ThreadResponse,
  type ThreadsResponse,
} from '@hpe/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../audit.js';
import {
  accessComment,
  accessThread,
  accessVersion,
  assertCanManageThread,
  requireWriter,
} from '../auth/access.js';
import { actorLabel } from '../auth/principal.js';
import type { AppContext } from '../context.js';
import type { DbLike } from '../db/client.js';
import { comments, threadNumberSeq, threads } from '../db/schema.js';
import { authorId, toThread } from '../dto.js';
import { idParam, parseWith } from '../http.js';
import { newId } from '../ids.js';
import { rateLimit, type RateLimiter } from '../plugins/rateLimit.js';

/** 以 `UPDATE … RETURNING` 取得專案內下一個 thread 編號（列鎖讓並行建立也不會重號）。 */
export async function nextThreadNumber(tx: DbLike, projectId: string): Promise<number> {
  const bump = () =>
    tx
      .update(threadNumberSeq)
      .set({ lastNumber: sql`${threadNumberSeq.lastNumber} + 1` })
      .where(eq(threadNumberSeq.projectId, projectId))
      .returning({ n: threadNumberSeq.lastNumber });
  let [row] = await bump();
  if (!row) {
    await tx.insert(threadNumberSeq).values({ projectId, lastNumber: 0 }).onConflictDoNothing();
    [row] = await bump();
  }
  return row!.n;
}

/** 版本內所有討論串（含留言），依編號排序。 */
export async function listVersionThreads(db: DbLike, versionId: string): Promise<Thread[]> {
  const rows = await db
    .select()
    .from(threads)
    .where(eq(threads.versionId, versionId))
    .orderBy(asc(threads.number));
  const cs = await db
    .select({ c: comments })
    .from(comments)
    .innerJoin(threads, eq(threads.id, comments.threadId))
    .where(eq(threads.versionId, versionId));
  const byThread = new Map<string, (typeof cs)[number]['c'][]>();
  for (const { c } of cs) {
    const list = byThread.get(c.threadId);
    if (list) list.push(c);
    else byThread.set(c.threadId, [c]);
  }
  return rows.map((t) => toThread(t, byThread.get(t.id) ?? []));
}

async function loadThread(db: DbLike, threadId: string): Promise<ThreadResponse['thread']> {
  const [t] = await db.select().from(threads).where(eq(threads.id, threadId));
  if (!t) throw new AppError('NOT_FOUND');
  const cs = await db.select().from(comments).where(eq(comments.threadId, threadId));
  return toThread(t, cs);
}

export function registerThreadRoutes(app: FastifyInstance, ctx: AppContext, limiter: RateLimiter) {
  const writeLimit = rateLimit(limiter, 'commentWrite');

  app.get(API_ROUTES.listThreads.path, async (req): Promise<ThreadsResponse> => {
    const { version } = await accessVersion(ctx, req, idParam(req.params));
    return { threads: await listVersionThreads(ctx.db, version.id) };
  });

  app.post(
    API_ROUTES.createThread.path,
    { preHandler: writeLimit },
    async (req, reply): Promise<ThreadResponse> => {
      const access = await accessVersion(ctx, req, idParam(req.params));
      const author = requireWriter(access);
      if (access.version.status !== 'ready') {
        throw new AppError('IMPORT_ENTRY_REQUIRED', '此版本尚未選定入口頁面，暫時不能留言');
      }
      const body = parseWith(CreateThreadBodySchema, req.body);
      const threadId = newId();
      await ctx.db.transaction(async (tx) => {
        const number = await nextThreadNumber(tx, access.project.id);
        await tx.insert(threads).values({
          id: threadId,
          versionId: access.version.id,
          projectId: access.project.id,
          number,
          anchor: body.anchor,
          status: 'open',
          tags: [...new Set(body.tags ?? [])],
          createdBy: author,
          createdById: authorId(author),
          createdAt: ctx.now(),
        });
        await tx.insert(comments).values({
          id: newId(),
          threadId,
          author,
          authorId: authorId(author),
          // 逐字儲存：伺服器端不解析、不渲染（一律由前端以純文字或 sanitize 後的 markdown 呈現）
          body: body.body,
          createdAt: ctx.now(),
        });
      });
      void reply.code(201);
      return { thread: await loadThread(ctx.db, threadId) };
    },
  );

  app.patch(API_ROUTES.updateThread.path, async (req): Promise<ThreadResponse> => {
    const access = await accessThread(ctx, req, idParam(req.params));
    const author = requireWriter(access);
    assertCanManageThread(access, author);
    const body = parseWith(UpdateThreadBodySchema, req.body);
    const set: Partial<typeof threads.$inferInsert> = {};
    if (body.status !== undefined && body.status !== access.thread.status) {
      set.status = body.status;
      set.resolvedAt = body.status === 'resolved' ? ctx.now() : null;
    }
    if (body.tags !== undefined) set.tags = [...new Set(body.tags)];
    if (Object.keys(set).length > 0) {
      await ctx.db.update(threads).set(set).where(eq(threads.id, access.thread.id));
    }
    return { thread: await loadThread(ctx.db, access.thread.id) };
  });

  app.delete(API_ROUTES.deleteThread.path, async (req) => {
    const access = await accessThread(ctx, req, idParam(req.params));
    const author = requireWriter(access);
    assertCanManageThread(access, author);
    await ctx.db.transaction(async (tx) => {
      await tx.delete(threads).where(eq(threads.id, access.thread.id));
      await writeAudit(tx, {
        actor: actorLabel(access.principal),
        action: 'thread.delete',
        target: access.thread.id,
        meta: { projectId: access.project.id, number: access.thread.number },
      });
    });
    return { ok: true };
  });

  app.post(
    API_ROUTES.createComment.path,
    { preHandler: writeLimit },
    async (req, reply): Promise<ThreadResponse> => {
      const access = await accessThread(ctx, req, idParam(req.params));
      const author = requireWriter(access);
      const body = parseWith(CreateCommentBodySchema, req.body);
      await ctx.db.insert(comments).values({
        id: newId(),
        threadId: access.thread.id,
        author,
        authorId: authorId(author),
        body: body.body,
        createdAt: ctx.now(),
      });
      void reply.code(201);
      return { thread: await loadThread(ctx.db, access.thread.id) };
    },
  );

  app.patch(API_ROUTES.updateComment.path, async (req): Promise<ThreadResponse> => {
    const access = await accessComment(ctx, req, idParam(req.params));
    const author = requireWriter(access);
    if (access.comment.authorId !== authorId(author)) {
      throw new AppError('FORBIDDEN', '只能編輯自己的留言');
    }
    const body = parseWith(UpdateCommentBodySchema, req.body);
    await ctx.db
      .update(comments)
      .set({ body: body.body, editedAt: ctx.now() })
      .where(eq(comments.id, access.comment.id));
    return { thread: await loadThread(ctx.db, access.thread.id) };
  });

  app.delete(API_ROUTES.deleteComment.path, async (req): Promise<DeleteCommentResponse> => {
    const access = await accessComment(ctx, req, idParam(req.params));
    const author = requireWriter(access);
    if (access.role !== 'owner' && access.comment.authorId !== authorId(author)) {
      throw new AppError('FORBIDDEN', '只能刪除自己的留言');
    }
    const threadGone = await ctx.db.transaction(async (tx) => {
      // 鎖住 thread 列，避免兩人同時刪最後兩則留言而留下空的 thread
      await tx
        .select({ id: threads.id })
        .from(threads)
        .where(eq(threads.id, access.thread.id))
        .for('update');
      await tx.delete(comments).where(eq(comments.id, access.comment.id));
      const remaining = await tx
        .select({ id: comments.id })
        .from(comments)
        .where(eq(comments.threadId, access.thread.id))
        .limit(1);
      if (remaining.length > 0) return false;
      await tx.delete(threads).where(eq(threads.id, access.thread.id));
      await writeAudit(tx, {
        actor: actorLabel(access.principal),
        action: 'thread.delete',
        target: access.thread.id,
        meta: {
          projectId: access.project.id,
          number: access.thread.number,
          reason: 'last-comment',
        },
      });
      return true;
    });
    return { thread: threadGone ? null : await loadThread(ctx.db, access.thread.id) };
  });
}
