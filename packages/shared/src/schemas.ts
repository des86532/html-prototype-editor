import { z } from 'zod';
import { COMMENT_LIMITS, MESSAGE_LIMITS, PROTOCOL_VERSION } from './limits.js';

/** 規格第 7 節。zod schema 是單一事實來源，types.ts 由 z.infer 衍生。 */

export const IdSchema = z.string().min(1).max(64);
export const IsoDateSchema = z.string().min(1).max(40);

export const RoleSchema = z.enum(['owner', 'commenter', 'viewer']);
export const ThreadStatusSchema = z.enum(['open', 'resolved']);
export const ThreadTagSchema = z.enum(['bug', 'copy', 'design', 'question', 'suggestion']);
export const AnchorStatusSchema = z.enum(['exact', 'fuzzy', 'hidden', 'fallback', 'orphaned']);
export const ModeSchema = z.enum(['interact', 'comment']);

const finite = z.number().finite();

export const RectSchema = z.object({ x: finite, y: finite, w: finite, h: finite });

const selectorString = z.string().max(MESSAGE_LIMITS.maxSelectorLength);

export const AnchorSchema = z.object({
  pageId: z.string().min(1).max(512),
  kind: z.enum(['element', 'region', 'text']),
  viewport: z.object({
    width: finite,
    height: finite,
    dpr: finite,
    preset: z.string().max(64).optional(),
  }),
  selectors: z.object({
    dataAttr: z.object({ name: z.string().max(128), value: z.string().max(256) }).optional(),
    css: selectorString.optional(),
    xpath: selectorString.optional(),
    textQuote: z
      .object({
        exact: z.string().max(256),
        prefix: z.string().max(32),
        suffix: z.string().max(32),
      })
      .optional(),
    fingerprint: z.object({
      tag: z.string().max(64),
      classes: z.array(z.string().max(128)).max(64),
      textHash: z.string().max(64),
      siblingIndex: z.number().int(),
      depth: z.number().int(),
    }),
    elementOffset: z.object({ x: finite, y: finite }),
    regionSize: z.object({ w: finite, h: finite }).optional(),
  }),
  fallback: RectSchema,
  stateHint: z
    .object({ hash: z.string().max(512).optional(), inDialog: z.boolean().optional() })
    .optional(),
  snapshot: z.object({
    tag: z.string().max(64),
    text: z.string().max(MESSAGE_LIMITS.maxSnapshotTextLength),
  }),
});

export const ResolvedAnchorSchema = z.object({
  threadId: IdSchema,
  status: AnchorStatusSchema,
  confidence: z.number().min(0).max(1),
  rect: RectSchema.nullable(),
});

/* ---------------- postMessage 協定 v1 ---------------- */

const v = z.literal(PROTOCOL_VERSION);

export const ParentToFrameSchema = z.discriminatedUnion('type', [
  z.object({
    v,
    type: z.literal('init'),
    mode: ModeSchema,
    storageSeed: z.string().max(MESSAGE_LIMITS.maxStorageBlobBytes).optional(),
  }),
  z.object({ v, type: z.literal('setMode'), mode: ModeSchema }),
  z.object({
    v,
    type: z.literal('resolveAnchors'),
    requestId: z.string().max(64),
    anchors: z
      .array(z.object({ threadId: IdSchema, anchor: AnchorSchema }))
      .max(MESSAGE_LIMITS.maxAnchorsPerRequest),
  }),
  z.object({
    v,
    type: z.literal('trackAnchors'),
    threadIds: z.array(IdSchema).max(MESSAGE_LIMITS.maxAnchorsPerRequest),
  }),
  z.object({ v, type: z.literal('scrollToAnchor'), threadId: IdSchema }),
  z.object({
    v,
    type: z.literal('describeAt'),
    requestId: z.string().max(64),
    point: z.object({ x: finite, y: finite }),
  }),
  z.object({ v, type: z.literal('ping'), seq: z.number().int() }),
]);

export const FrameToParentSchema = z.discriminatedUnion('type', [
  z.object({
    v,
    type: z.literal('ready'),
    agentVersion: z.string().max(32),
    pageId: z.string().max(512),
    hash: z.string().max(512),
    docSize: z.object({ w: finite, h: finite }),
  }),
  z.object({
    v,
    type: z.literal('hover'),
    rect: RectSchema.nullable(),
    label: z.string().max(MESSAGE_LIMITS.maxLabelLength),
  }),
  z.object({ v, type: z.literal('pick'), draft: AnchorSchema, rect: RectSchema }),
  z.object({
    v,
    type: z.literal('anchorsResolved'),
    requestId: z.string().max(64),
    results: z.array(ResolvedAnchorSchema).max(MESSAGE_LIMITS.maxAnchorsPerRequest),
  }),
  z.object({
    v,
    type: z.literal('geometry'),
    viewport: z.object({ w: finite, h: finite }),
    rects: z
      .record(IdSchema, RectSchema.nullable())
      .refine((r) => Object.keys(r).length <= MESSAGE_LIMITS.maxRects, 'too many rects'),
  }),
  z.object({ v, type: z.literal('navigateRequest'), pageId: z.string().max(512) }),
  z.object({
    v,
    type: z.literal('dialog'),
    kind: z.enum(['alert', 'confirm', 'prompt']),
    text: z.string().max(MESSAGE_LIMITS.maxDialogTextLength),
  }),
  z.object({
    v,
    type: z.literal('storageSnapshot'),
    data: z.string().max(MESSAGE_LIMITS.maxStorageBlobBytes),
  }),
  z.object({
    v,
    type: z.literal('described'),
    requestId: z.string().max(64),
    draft: AnchorSchema,
    rect: RectSchema,
  }),
  z.object({ v, type: z.literal('pong'), seq: z.number().int() }),
]);

/* ---------------- 領域模型 ---------------- */

export const AuthorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: IdSchema, name: z.string().max(120) }),
  z.object({ kind: z.literal('guest'), guestId: IdSchema, name: z.string().max(120) }),
]);

export const CommentSchema = z.object({
  id: IdSchema,
  threadId: IdSchema,
  author: AuthorSchema,
  body: z.string().max(COMMENT_LIMITS.maxBodyLength),
  createdAt: IsoDateSchema,
  editedAt: IsoDateSchema.optional(),
});

export const ThreadSchema = z.object({
  id: IdSchema,
  versionId: IdSchema,
  number: z.number().int().positive(),
  anchor: AnchorSchema,
  status: ThreadStatusSchema,
  tags: z.array(ThreadTagSchema).max(COMMENT_LIMITS.maxTagsPerThread),
  createdBy: AuthorSchema,
  createdAt: IsoDateSchema,
  resolvedAt: IsoDateSchema.optional(),
  comments: z.array(CommentSchema),
  carriedFrom: z
    .object({ threadId: IdSchema, versionId: IdSchema, resolution: AnchorStatusSchema })
    .optional(),
});

export const PageInfoSchema = z.object({ path: z.string(), title: z.string().nullable() });

export const ExternalResourceKindSchema = z.enum([
  'script',
  'style',
  'img',
  'font',
  'media',
  'other',
]);

export const SecurityReportSchema = z.object({
  scripts: z.object({ inline: z.number().int(), external: z.array(z.string()) }),
  externalResources: z.array(
    z.object({ url: z.string(), kind: ExternalResourceKindSchema, blocked: z.boolean() }),
  ),
  forms: z.number().int(),
  passwordInputs: z.number().int(),
  iframes: z.array(z.string()),
  metaRefresh: z.boolean(),
  baseTag: z.boolean(),
  serviceWorkerRegistration: z.boolean(),
  warnings: z.array(z.string()),
});

export const PrototypeVersionSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  number: z.number().int().positive(),
  contentKey: z.string(),
  /** 尚未決定入口（status = 'processing' 且 entryCandidates 非空）時為空字串 */
  entryPage: z.string(),
  pages: z.array(PageInfoSchema),
  cdnAllowlist: z.array(z.string()),
  analysis: SecurityReportSchema,
  status: z.enum(['processing', 'ready', 'rejected']),
  /** 多個 html 且沒有 index.html 時，列出候選讓使用者選（M2 entryDetect） */
  entryCandidates: z.array(z.string()).optional(),
  createdAt: IsoDateSchema,
});

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  ownerId: IdSchema,
  createdAt: IsoDateSchema,
});

export const UserSchema = z.object({ id: IdSchema, email: z.string(), name: z.string() });

export const ShareLinkSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  role: z.enum(['commenter', 'viewer']),
  expiresAt: IsoDateSchema.optional(),
  revokedAt: IsoDateSchema.optional(),
  createdAt: IsoDateSchema,
});

/* ---------------- REST DTO（apps/api 與 apps/web 共用） ---------------- */

export const CreateProjectBodySchema = z.object({ name: z.string().trim().min(1).max(120) });

export const CreateVersionJsonBodySchema = z.object({
  /** 貼上原始碼 */
  html: z.string().min(1),
  entryPage: z.string().optional(),
});

export const UpdateVersionBodySchema = z.object({
  entryPage: z.string().optional(),
  /** origin 清單，例如 https://cdn.jsdelivr.net；只能是 CDN_PRESETS 中的 origin */
  cdnAllowlist: z.array(z.string().url()).optional(),
});

export const CreateThreadBodySchema = z.object({
  anchor: AnchorSchema,
  body: z.string().trim().min(1).max(COMMENT_LIMITS.maxBodyLength),
  tags: z.array(ThreadTagSchema).max(COMMENT_LIMITS.maxTagsPerThread).optional(),
});

export const CreateCommentBodySchema = z.object({
  body: z.string().trim().min(1).max(COMMENT_LIMITS.maxBodyLength),
});

export const UpdateThreadBodySchema = z
  .object({
    status: ThreadStatusSchema.optional(),
    tags: z.array(ThreadTagSchema).max(COMMENT_LIMITS.maxTagsPerThread).optional(),
  })
  .refine((b) => b.status !== undefined || b.tags !== undefined, 'empty patch');

export const UpdateCommentBodySchema = CreateCommentBodySchema;

export const CreateShareLinkBodySchema = z.object({
  role: z.enum(['commenter', 'viewer']),
  expiresAt: IsoDateSchema.optional(),
});

export const GuestIdentityBodySchema = z.object({
  name: z.string().trim().min(1).max(COMMENT_LIMITS.maxGuestNameLength),
  /** 重新進入時帶上舊 guestToken，伺服器沿用同一個 guestId */
  guestToken: z.string().max(512).optional(),
});

export const DevLoginBodySchema = z.object({ email: z.string().email().max(254) });
