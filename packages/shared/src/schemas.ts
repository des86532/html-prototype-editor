import { z } from 'zod';
import {
  COMMENT_LIMITS,
  MARKUP_COLORS,
  MARKUP_LIMITS,
  MESSAGE_LIMITS,
  PROTOCOL_VERSION,
} from './limits.js';

/** 規格第 7 節。zod schema 是單一事實來源，types.ts 由 z.infer 衍生。 */

export const IdSchema = z.string().min(1).max(64);
export const IsoDateSchema = z.string().min(1).max(40);

export const RoleSchema = z.enum(['owner', 'commenter', 'viewer']);
export const ThreadStatusSchema = z.enum(['open', 'resolved']);

const finite = z.number().finite();

/* ---------------- 標記（畫在頁面上的形狀） ---------------- */

const coord = z
  .number()
  .finite()
  .min(-MARKUP_LIMITS.maxCoordinate)
  .max(MARKUP_LIMITS.maxCoordinate);
const PointSchema = z.object({ x: coord, y: coord });
const strokeStyle = {
  color: z.enum(MARKUP_COLORS),
  stroke: z.union([z.literal(2), z.literal(4), z.literal(8)]),
};
const polyline = z
  .array(z.tuple([coord, coord]))
  .min(2)
  .max(MARKUP_LIMITS.maxPoints);

export const MarkupShapeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rect'),
    x: coord,
    y: coord,
    w: coord.positive(),
    h: coord.positive(),
    ...strokeStyle,
  }),
  z.object({ kind: z.literal('arrow'), from: PointSchema, to: PointSchema, ...strokeStyle }),
  z.object({ kind: z.literal('pen'), points: polyline, ...strokeStyle }),
  z.object({ kind: z.literal('highlighter'), points: polyline, ...strokeStyle }),
  z.object({
    kind: z.literal('text'),
    x: coord,
    y: coord,
    text: z.string().trim().min(1).max(MARKUP_LIMITS.maxTextLength),
    ...strokeStyle,
  }),
]);

const viewportSide = z.number().int().min(MARKUP_LIMITS.minViewport).max(MARKUP_LIMITS.maxViewport);

export const MarkupSchema = z.object({
  /** bundle 內頁面路徑 */
  pageId: z.string().min(1).max(512),
  /** 畫的當下的裝置尺寸；只在 width 相同時顯示 */
  viewport: z.object({ width: viewportSide, height: viewportSide }),
  shape: MarkupShapeSchema,
});

export const MarkupToolSchema = z.enum(['rect', 'arrow', 'pen', 'highlighter', 'text']);

/* ---------------- postMessage 協定 v1 ---------------- */

const v = z.literal(PROTOCOL_VERSION);

export const ParentToFrameSchema = z.discriminatedUnion('type', [
  z.object({
    v,
    type: z.literal('init'),
    storageSeed: z.string().max(MESSAGE_LIMITS.maxStorageBlobBytes).optional(),
  }),
  z.object({ v, type: z.literal('scrollTo'), x: finite, y: finite }),
  z.object({ v, type: z.literal('scrollBy'), dx: finite, dy: finite }),
  z.object({ v, type: z.literal('ping'), seq: z.number().int() }),
]);

export const FrameToParentSchema = z.discriminatedUnion('type', [
  z.object({
    v,
    type: z.literal('ready'),
    agentVersion: z.string().max(32),
    pageId: z.string().max(512),
    hash: z.string().max(512),
  }),
  z.object({
    v,
    type: z.literal('scroll'),
    x: finite,
    y: finite,
    docW: finite,
    docH: finite,
    vw: finite,
    vh: finite,
  }),
  /** 游標位置（viewport 座標）；離開 frame 時為 null */
  z.object({ v, type: z.literal('pointer'), x: finite.nullable(), y: finite.nullable() }),
  /** iframe 內的 ⌘／Ctrl＋滾輪（含觸控板捏合）：parent 用來縮放。x、y 是 frame viewport 座標 */
  z.object({ v, type: z.literal('zoomWheel'), dy: finite, x: finite, y: finite }),
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
  /** 第一則說明送出時才編號；沒有說明的標記為 null */
  number: z.number().int().positive().nullable(),
  markup: MarkupSchema,
  status: ThreadStatusSchema,
  createdBy: AuthorSchema,
  createdAt: IsoDateSchema,
  resolvedAt: IsoDateSchema.optional(),
  comments: z.array(CommentSchema),
  /** 每次寫入 +1；即時同步時用來避免較舊的快照蓋掉較新的 */
  rev: z.number().int().positive(),
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
  markup: MarkupSchema,
  body: z.string().trim().min(1).max(COMMENT_LIMITS.maxBodyLength).optional(),
});

export const CreateCommentBodySchema = z.object({
  body: z.string().trim().min(1).max(COMMENT_LIMITS.maxBodyLength),
});

export const UpdateThreadBodySchema = z
  .object({
    status: ThreadStatusSchema.optional(),
    shape: MarkupShapeSchema.optional(),
  })
  .refine((b) => b.status !== undefined || b.shape !== undefined, 'empty patch');

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
