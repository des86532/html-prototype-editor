import type {
  Author,
  Comment,
  Project,
  PrototypeVersion,
  ShareLink,
  Thread,
  User,
} from '@hpe/shared';
import type { InferSelectModel } from 'drizzle-orm';
import type {
  comments,
  projects,
  prototypeVersions,
  shareLinks,
  threads,
  users,
} from './db/schema.js';

export type UserRow = InferSelectModel<typeof users>;
export type ProjectRow = InferSelectModel<typeof projects>;
export type VersionRow = InferSelectModel<typeof prototypeVersions>;
export type ThreadRow = InferSelectModel<typeof threads>;
export type CommentRow = InferSelectModel<typeof comments>;
export type ShareLinkRow = InferSelectModel<typeof shareLinks>;

export const iso = (d: Date): string => d.toISOString();

export function toUser(u: UserRow): User {
  return { id: u.id, email: u.email, name: u.name };
}

export function toProject(p: ProjectRow): Project {
  return { id: p.id, name: p.name, ownerId: p.ownerId, createdAt: iso(p.createdAt) };
}

export function toVersion(v: VersionRow): PrototypeVersion {
  return {
    id: v.id,
    projectId: v.projectId,
    number: v.number,
    contentKey: v.contentKey,
    entryPage: v.entryPage,
    pages: v.pages,
    cdnAllowlist: v.cdnAllowlist,
    analysis: v.analysis,
    status: v.status,
    ...(v.status === 'processing' && v.entryCandidates?.length
      ? { entryCandidates: v.entryCandidates }
      : {}),
    createdAt: iso(v.createdAt),
  };
}

export function toComment(c: CommentRow): Comment {
  return {
    id: c.id,
    threadId: c.threadId,
    author: c.author,
    body: c.body,
    createdAt: iso(c.createdAt),
    ...(c.editedAt ? { editedAt: iso(c.editedAt) } : {}),
  };
}

export function toThread(t: ThreadRow, cs: CommentRow[]): Thread {
  const sorted = [...cs].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  return {
    id: t.id,
    versionId: t.versionId,
    number: t.number,
    anchor: t.anchor,
    status: t.status,
    tags: t.tags,
    createdBy: t.createdBy,
    createdAt: iso(t.createdAt),
    ...(t.resolvedAt ? { resolvedAt: iso(t.resolvedAt) } : {}),
    comments: sorted.map(toComment),
    ...(t.carriedFrom ? { carriedFrom: t.carriedFrom } : {}),
  };
}

export function toShareLink(l: ShareLinkRow): ShareLink {
  return {
    id: l.id,
    projectId: l.projectId,
    role: l.role,
    ...(l.expiresAt ? { expiresAt: iso(l.expiresAt) } : {}),
    ...(l.revokedAt ? { revokedAt: iso(l.revokedAt) } : {}),
    createdAt: iso(l.createdAt),
  };
}

export function authorId(a: Author): string {
  return a.kind === 'user' ? a.userId : a.guestId;
}
