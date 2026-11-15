import type { z } from 'zod';
import type { MARKUP_COLORS, MARKUP_STROKES } from './limits.js';
import type {
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
  MarkupSchema,
  MarkupShapeSchema,
  MarkupToolSchema,
  PageInfoSchema,
  ParentToFrameSchema,
  PrototypeVersionSchema,
  ProjectSchema,
  RoleSchema,
  SecurityReportSchema,
  ShareLinkSchema,
  ThreadSchema,
  ThreadStatusSchema,
  UpdateCommentBodySchema,
  UpdateThreadBodySchema,
  UpdateVersionBodySchema,
  UserSchema,
} from './schemas.js';

export type Id = z.infer<typeof IdSchema>; // ULID
export type Role = z.infer<typeof RoleSchema>;
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export type Markup = z.infer<typeof MarkupSchema>;
export type MarkupShape = z.infer<typeof MarkupShapeSchema>;
export type MarkupTool = z.infer<typeof MarkupToolSchema>;
export type MarkupColor = (typeof MARKUP_COLORS)[number];
export type MarkupStroke = (typeof MARKUP_STROKES)[number];

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
