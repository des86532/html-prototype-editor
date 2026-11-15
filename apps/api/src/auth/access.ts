import { AppError, type Role } from '@hpe/shared';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { comments, projects, prototypeVersions, threads } from '../db/schema.js';
import type { CommentRow, ProjectRow, ThreadRow, VersionRow } from '../dto.js';
import { authorId } from '../dto.js';
import { sha256Hex } from '../ids.js';
import { authorOf, getPrincipal, type Principal } from './principal.js';
import type { Author } from '@hpe/shared';

export interface ProjectAccess {
  principal: Principal;
  project: ProjectRow;
  role: Role;
}

/**
 * 判斷 principal 對專案的存取權。查無專案與「無權存取」一律回 NOT_FOUND，不洩漏其他專案是否存在。
 * 匿名（沒有 session 也沒有 share token）回 UNAUTHENTICATED。
 */
export async function accessProject(
  ctx: AppContext,
  req: FastifyRequest,
  projectId: string,
): Promise<ProjectAccess> {
  return projectAccessFor(ctx, await getPrincipal(ctx, req), projectId);
}

/** `accessProject` 中依 principal 判斷的部分（WebSocket 沒有 FastifyRequest 身分快取時也能用）。 */
export async function projectAccessFor(
  ctx: AppContext,
  principal: Principal,
  projectId: string,
): Promise<ProjectAccess> {
  if (principal.kind === 'anonymous') throw new AppError('UNAUTHENTICATED', '請先登入');
  if (principal.kind === 'share' && principal.link.projectId !== projectId) {
    throw new AppError('NOT_FOUND');
  }
  const [project] = await ctx.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new AppError('NOT_FOUND');
  if (principal.kind === 'user') {
    if (project.ownerId !== principal.user.id) throw new AppError('NOT_FOUND');
    return { principal, project, role: 'owner' };
  }
  if (principal.kind !== 'share') throw new AppError('NOT_FOUND');
  return { principal, project, role: principal.role };
}

/** 只有擁有者可以做的操作（專案管理、版本管理、分享連結）。 */
export async function accessOwnedProject(
  ctx: AppContext,
  req: FastifyRequest,
  projectId: string,
): Promise<ProjectAccess> {
  const principal = await getPrincipal(ctx, req);
  if (principal.kind === 'share') {
    // 先確認是同專案，其他專案維持 404
    if (principal.link.projectId !== projectId) throw new AppError('NOT_FOUND');
    throw new AppError('FORBIDDEN', '此操作僅限專案擁有者');
  }
  return accessProject(ctx, req, projectId);
}

export interface VersionAccess extends ProjectAccess {
  version: VersionRow;
}

async function loadVersion(ctx: AppContext, versionId: string): Promise<VersionRow> {
  const [version] = await ctx.db
    .select()
    .from(prototypeVersions)
    .where(eq(prototypeVersions.id, versionId))
    .limit(1);
  if (!version) throw new AppError('NOT_FOUND');
  return version;
}

export async function accessVersion(
  ctx: AppContext,
  req: FastifyRequest,
  versionId: string,
): Promise<VersionAccess> {
  return accessVersionFor(ctx, await getPrincipal(ctx, req), versionId);
}

export async function accessVersionFor(
  ctx: AppContext,
  principal: Principal,
  versionId: string,
): Promise<VersionAccess> {
  if (principal.kind === 'anonymous') throw new AppError('UNAUTHENTICATED', '請先登入');
  const version = await loadVersion(ctx, versionId);
  const access = await projectAccessFor(ctx, principal, version.projectId);
  return { ...access, version };
}

/** session cookie 的雜湊（sessions.hash）；hub 以它找出登出的連線。 */
export function sessionHashOf(cookie: string): string {
  return sha256Hex(cookie);
}

export async function accessOwnedVersion(
  ctx: AppContext,
  req: FastifyRequest,
  versionId: string,
): Promise<VersionAccess> {
  const principal = await getPrincipal(ctx, req);
  if (principal.kind === 'anonymous') throw new AppError('UNAUTHENTICATED', '請先登入');
  const version = await loadVersion(ctx, versionId);
  const access = await accessOwnedProject(ctx, req, version.projectId);
  return { ...access, version };
}

export interface ThreadAccess extends ProjectAccess {
  thread: ThreadRow;
}

export async function accessThread(
  ctx: AppContext,
  req: FastifyRequest,
  threadId: string,
): Promise<ThreadAccess> {
  const principal = await getPrincipal(ctx, req);
  if (principal.kind === 'anonymous') throw new AppError('UNAUTHENTICATED', '請先登入');
  const [thread] = await ctx.db.select().from(threads).where(eq(threads.id, threadId)).limit(1);
  if (!thread) throw new AppError('NOT_FOUND');
  const access = await accessProject(ctx, req, thread.projectId);
  return { ...access, thread };
}

export interface CommentAccess extends ThreadAccess {
  comment: CommentRow;
}

export async function accessComment(
  ctx: AppContext,
  req: FastifyRequest,
  commentId: string,
): Promise<CommentAccess> {
  const principal = await getPrincipal(ctx, req);
  if (principal.kind === 'anonymous') throw new AppError('UNAUTHENTICATED', '請先登入');
  const [comment] = await ctx.db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!comment) throw new AppError('NOT_FOUND');
  const access = await accessThread(ctx, req, comment.threadId);
  return { ...access, comment };
}

/**
 * 寫入留言／討論串的身分檢查：viewer 不可寫（SHARE_ROLE_FORBIDDEN）；
 * 分享連結的 commenter 必須帶有效的 guest token（GUEST_REQUIRED）。回傳作者。
 */
export function requireWriter(access: ProjectAccess): Author {
  if (access.role === 'viewer') {
    throw new AppError('SHARE_ROLE_FORBIDDEN', '此分享連結僅能檢視，不能留言');
  }
  const author = authorOf(access.principal);
  if (!author) throw new AppError('GUEST_REQUIRED', '請先填寫名字才能留言');
  return author;
}

/** 擁有者可管理任何討論串；commenter 只能管理自己建立的。 */
export function assertCanManageThread(access: ThreadAccess, author: Author): void {
  if (access.role === 'owner') return;
  if (access.thread.createdById !== authorId(author)) {
    throw new AppError('FORBIDDEN', '只能修改自己建立的討論串');
  }
}
