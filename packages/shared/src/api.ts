import type {
  Author,
  Project,
  PrototypeVersion,
  Role,
  ShareLink,
  Thread,
  User,
  AssetManifestEntry,
} from './types.js';

/**
 * REST 契約（apps/api ↔ apps/web）。所有錯誤回應都是 `{ error: ApiErrorBody }`（見 errors.ts）。
 * 認證：
 *  - 擁有者：HttpOnly cookie `hpe_session`（SameSite=Lax，Google 登入後由 API 設定），跨 origin fetch 需 `credentials: 'include'`。
 *  - 分享連結使用者：每個請求帶 header `x-share-token`（原始 token，DB 只存 sha256）；
 *    寫入評論還要帶 `x-guest-token`（POST /share/:token/guest 取得，伺服器簽章）。
 */
export const API_HEADERS = {
  shareToken: 'x-share-token',
  guestToken: 'x-guest-token',
  internalToken: 'x-internal-token',
} as const;

export const SESSION_COOKIE = 'hpe_session';
/** Google OAuth 進行中的 state/PKCE verifier/nonce（HttpOnly，Path=/auth/google，10 分鐘）。 */
export const OAUTH_COOKIE = 'hpe_oauth';

export interface MeResponse {
  user: User;
}
export interface ListProjectsResponse {
  projects: Project[];
}
export interface ProjectResponse {
  project: Project;
}
export interface ProjectDetailResponse {
  project: Project;
  versions: PrototypeVersion[];
}
export interface VersionResponse {
  version: PrototypeVersion;
}
/** GET /versions/:id：同時給擁有者與分享連結使用者（role 反映目前身分）。 */
export interface VersionDetailResponse {
  version: PrototypeVersion;
  project: Project;
  role: Role;
  /** 目前身分；擁有者為 user，分享連結且已填名字為 guest，否則為 null */
  me: Author | null;
}
export interface ThreadsResponse {
  threads: Thread[];
}
export interface ThreadResponse {
  thread: Thread;
}
/** 所有 DELETE（project、version、thread）、logout 回 200 `{ ok: true }`（不是 204）。 */
export interface OkResponse {
  ok: true;
}
export interface DeleteCommentResponse {
  /** 刪除最後一則留言時整個 thread 一併刪除，回傳 null */
  thread: Thread | null;
}
export interface ShareLinksResponse {
  links: ShareLink[];
}
export interface CreateShareLinkResponse {
  link: ShareLink;
  /** 原始 token 只會在建立時回傳一次 */
  token: string;
  /** `${APP_ORIGIN}/s/${token}` */
  url: string;
}
export interface ShareResolveResponse {
  project: Project;
  role: Exclude<Role, 'owner'>;
  versions: PrototypeVersion[];
}
export interface GuestIdentityResponse {
  guestToken: string;
  guest: { guestId: string; name: string };
}
export interface InternalContentResponse {
  versionId: string;
  contentKey: string;
  entryPage: string;
  cdnAllowlist: string[];
  assets: AssetManifestEntry[];
}

export type ExportFormat = 'json' | 'markdown' | 'csv' | 'html' | 'package';
export const EXPORT_FORMATS: readonly ExportFormat[] = [
  'json',
  'markdown',
  'csv',
  'html',
  'package',
];

export interface ExportQuery {
  status?: 'open' | 'resolved';
  tag?: string;
}

export interface ExportEstimateResponse {
  /** 預估單檔 HTML 位元組（含 base64 膨脹） */
  htmlBytes: number;
  packageBytes: number;
  threadCount: number;
  warnLargeHtml: boolean;
}

/** 路徑表。`:id` 一律使用 buildPath 展開，前後端不要各自拼字串。 */
export const API_ROUTES = {
  me: { method: 'GET', path: '/me' },
  googleLogin: { method: 'GET', path: '/auth/google' },
  googleCallback: { method: 'GET', path: '/auth/google/callback' },
  devLogin: { method: 'POST', path: '/auth/dev-login' },
  logout: { method: 'POST', path: '/auth/logout' },
  listProjects: { method: 'GET', path: '/projects' },
  createProject: { method: 'POST', path: '/projects' },
  getProject: { method: 'GET', path: '/projects/:id' },
  deleteProject: { method: 'DELETE', path: '/projects/:id' },
  createVersion: { method: 'POST', path: '/projects/:id/versions' },
  importPackage: { method: 'POST', path: '/projects/:id/import-package' },
  getVersion: { method: 'GET', path: '/versions/:id' },
  updateVersion: { method: 'PATCH', path: '/versions/:id' },
  deleteVersion: { method: 'DELETE', path: '/versions/:id' },
  rotateContentKey: { method: 'POST', path: '/versions/:id/rotate-content-key' },
  listThreads: { method: 'GET', path: '/versions/:id/threads' },
  createThread: { method: 'POST', path: '/versions/:id/threads' },
  updateThread: { method: 'PATCH', path: '/threads/:id' },
  deleteThread: { method: 'DELETE', path: '/threads/:id' },
  createComment: { method: 'POST', path: '/threads/:id/comments' },
  updateComment: { method: 'PATCH', path: '/comments/:id' },
  deleteComment: { method: 'DELETE', path: '/comments/:id' },
  listShareLinks: { method: 'GET', path: '/projects/:id/share-links' },
  createShareLink: { method: 'POST', path: '/projects/:id/share-links' },
  revokeShareLink: { method: 'DELETE', path: '/share-links/:id' },
  resolveShare: { method: 'GET', path: '/share/:id' },
  guestIdentity: { method: 'POST', path: '/share/:id/guest' },
  exportEstimate: { method: 'GET', path: '/versions/:id/export-estimate' },
  exportVersion: { method: 'GET', path: '/versions/:id/export/:format' },
  internalContent: { method: 'GET', path: '/internal/content/:id' },
  internalBlob: { method: 'GET', path: '/internal/blob/:id' },
  cspReport: { method: 'POST', path: '/csp-report' },
} as const;

export type ApiRouteName = keyof typeof API_ROUTES;

export function buildPath(route: ApiRouteName, params: Record<string, string> = {}): string {
  return API_ROUTES[route].path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`missing path param :${key} for ${route}`);
    return encodeURIComponent(value);
  });
}

/** `${scheme}://${contentKey}.${baseDomain}/${pagePath}`（開發：http + content.localhost:5174）。 */
export function contentUrl(
  baseDomain: string,
  contentKey: string,
  pagePath: string,
  scheme: 'http' | 'https' = 'https',
): string {
  const clean = pagePath.replace(/^\/+/, '');
  return `${scheme}://${contentKey}.${baseDomain}/${clean}`;
}
