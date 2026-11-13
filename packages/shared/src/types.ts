import type { z } from 'zod';
import type {
  AnchorSchema,
  AnchorStatusSchema,
  AuthorSchema,
  CommentSchema,
  CreateCommentBodySchema,
  CreateProjectBodySchema,
  CreateShareLinkBodySchema,
  CreateThreadBodySchema,
  CreateVersionJsonBodySchema,
  FrameToParentSchema,
  GuestIdentityBodySchema,
  IdSchema,
  ModeSchema,
  PageInfoSchema,
  ParentToFrameSchema,
  PrototypeVersionSchema,
  ProjectSchema,
  RectSchema,
  ResolvedAnchorSchema,
  RoleSchema,
  SecurityReportSchema,
  ShareLinkSchema,
  ThreadSchema,
  ThreadStatusSchema,
  ThreadTagSchema,
  UpdateCommentBodySchema,
  UpdateThreadBodySchema,
  UpdateVersionBodySchema,
  UserSchema,
} from './schemas.js';

export type Id = z.infer<typeof IdSchema>; // ULID
export type Role = z.infer<typeof RoleSchema>;
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;
export type ThreadTag = z.infer<typeof ThreadTagSchema>;
export type AnchorStatus = z.infer<typeof AnchorStatusSchema>;
export type Mode = z.infer<typeof ModeSchema>;

export type Rect = z.infer<typeof RectSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type ResolvedAnchor = z.infer<typeof ResolvedAnchorSchema>;

export type Author = z.infer<typeof AuthorSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;
export type SecurityReport = z.infer<typeof SecurityReportSchema>;
export type PrototypeVersion = z.infer<typeof PrototypeVersionSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type User = z.infer<typeof UserSchema>;
export type ShareLink = z.infer<typeof ShareLinkSchema>;

export type ParentToFrame = z.infer<typeof ParentToFrameSchema>;
export type FrameToParent = z.infer<typeof FrameToParentSchema>;

export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;
export type CreateVersionJsonBody = z.infer<typeof CreateVersionJsonBodySchema>;
export type UpdateVersionBody = z.infer<typeof UpdateVersionBodySchema>;
export type CreateThreadBody = z.infer<typeof CreateThreadBodySchema>;
export type CreateCommentBody = z.infer<typeof CreateCommentBodySchema>;
export type UpdateThreadBody = z.infer<typeof UpdateThreadBodySchema>;
export type UpdateCommentBody = z.infer<typeof UpdateCommentBodySchema>;
export type CreateShareLinkBody = z.infer<typeof CreateShareLinkBodySchema>;
export type GuestIdentityBody = z.infer<typeof GuestIdentityBodySchema>;

export interface AssetRecord {
  versionId: Id;
  path: string;
  sha256: string;
  size: number;
  mime: string;
}

export interface AssetManifestEntry {
  path: string;
  sha256: string;
  size: number;
  mime: string;
}

/** 留言面板／畫面 pin 共用的篩選條件（規格：狀態、頁面、寬度、作者、標籤）。 */
export interface ThreadFilters {
  status: ThreadStatus | 'all';
  /** bundle 內頁面路徑；null = 全部 */
  pageId: string | null;
  /** 「只看目前寬度」：以 anchor.viewport.width 比對；null = 全部 */
  width: number | null;
  /** 作者 id（userId 或 guestId）；null = 全部 */
  authorId: string | null;
  tag: ThreadTag | null;
}

export const DEFAULT_THREAD_FILTERS: ThreadFilters = {
  status: 'all',
  pageId: null,
  width: null,
  authorId: null,
  tag: null,
};
