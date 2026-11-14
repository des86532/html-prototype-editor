import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  Anchor,
  AnchorStatus,
  Author,
  PageInfo,
  SecurityReport,
  ThreadTag,
} from '@hpe/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  /** Google OIDC `sub`。既有使用者第一次用 Google 登入時依 email 綁定。 */
  googleSub: text('google_sub').unique(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('projects_owner_idx').on(t.ownerId)],
);

/** 每個專案一列的 thread 編號計數器（`INSERT … ON CONFLICT DO UPDATE … RETURNING` 取號）。 */
export const threadNumberSeq = pgTable('thread_number_seq', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  lastNumber: integer('last_number').notNull().default(0),
});

export const prototypeVersions = pgTable(
  'prototype_versions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    contentKey: text('content_key').notNull().unique(),
    entryPage: text('entry_page').notNull(),
    pages: jsonb('pages').$type<PageInfo[]>().notNull(),
    cdnAllowlist: jsonb('cdn_allowlist').$type<string[]>().notNull(),
    analysis: jsonb('analysis').$type<SecurityReport>().notNull(),
    status: text('status').$type<'processing' | 'ready' | 'rejected'>().notNull(),
    entryCandidates: jsonb('entry_candidates').$type<string[] | null>(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('prototype_versions_project_number_uq').on(t.projectId, t.number)],
);

export const assets = pgTable(
  'assets',
  {
    versionId: text('version_id')
      .notNull()
      .references(() => prototypeVersions.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    sha256: text('sha256').notNull(),
    size: integer('size').notNull(),
    mime: text('mime').notNull(),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.path] }), index('assets_sha256_idx').on(t.sha256)],
);

export const threads = pgTable(
  'threads',
  {
    id: text('id').primaryKey(),
    versionId: text('version_id')
      .notNull()
      .references(() => prototypeVersions.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    anchor: jsonb('anchor').$type<Anchor>().notNull(),
    status: text('status').$type<'open' | 'resolved'>().notNull().default('open'),
    tags: jsonb('tags').$type<ThreadTag[]>().notNull().default([]),
    createdBy: jsonb('created_by').$type<Author>().notNull(),
    /** userId 或 guestId，用於權限比對 */
    createdById: text('created_by_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
    carriedFrom: jsonb('carried_from').$type<{
      threadId: string;
      versionId: string;
      resolution: AnchorStatus;
    } | null>(),
  },
  (t) => [
    unique('threads_project_number_uq').on(t.projectId, t.number),
    index('threads_version_idx').on(t.versionId),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    author: jsonb('author').$type<Author>().notNull(),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    editedAt: ts('edited_at'),
  },
  (t) => [index('comments_thread_idx').on(t.threadId)],
);

export const shareLinks = pgTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** sha256(token) hex；原始 token 永遠不落地 */
    tokenHash: text('token_hash').notNull(),
    role: text('role').$type<'commenter' | 'viewer'>().notNull(),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('share_links_token_hash_uq').on(t.tokenHash),
    index('share_links_project_idx').on(t.projectId),
  ],
);

export const exportJobs = pgTable('export_jobs', {
  id: text('id').primaryKey(),
  versionId: text('version_id')
    .notNull()
    .references(() => prototypeVersions.id, { onDelete: 'cascade' }),
  format: text('format').notNull(),
  status: text('status').$type<'queued' | 'running' | 'done' | 'failed'>().notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  resultKey: text('result_key'),
  error: text('error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    /** user:<id> | guest:<id> | share:<linkId> | system */
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    target: text('target'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_at_idx').on(t.at)],
);

export const sessions = pgTable(
  'sessions',
  {
    hash: text('hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);
