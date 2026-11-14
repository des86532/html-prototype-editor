import type {
  Anchor,
  CreateShareLinkResponse,
  CreateVersionJsonBody,
  DeleteCommentResponse,
  ExportEstimateResponse,
  ExportFormat,
  ExportQuery,
  GuestIdentityResponse,
  ListProjectsResponse,
  MeResponse,
  ProjectDetailResponse,
  ProjectResponse,
  ShareLinksResponse,
  ShareResolveResponse,
  ThreadResponse,
  ThreadsResponse,
  ThreadStatus,
  ThreadTag,
  VersionDetailResponse,
  VersionResponse,
} from '@hpe/shared';
import { apiClient, type ApiClient, type DownloadResult } from './apiClient';

/**
 * 型別化的 API 操作（對應 `API_ROUTES`）。所有 feature 與 hooks 透過 `api` 取用，
 * 測試時以 `createApi(new ApiClient({ fetchImpl }))` 注入假的 fetch。
 */
export function createApi(c: ApiClient) {
  return {
    me: () => c.request<MeResponse>('me'),
    devLogin: (email: string) => c.request<MeResponse>('devLogin', { json: { email } }),
    logout: () => c.request<void>('logout'),

    listProjects: () => c.request<ListProjectsResponse>('listProjects'),
    createProject: (name: string) =>
      c.request<ProjectResponse>('createProject', { json: { name } }),
    getProject: (id: string) => c.request<ProjectDetailResponse>('getProject', { params: { id } }),
    deleteProject: (id: string) => c.request<void>('deleteProject', { params: { id } }),

    /** 貼上原始碼（JSON）。 */
    createVersionFromSource: (projectId: string, body: CreateVersionJsonBody) =>
      c.request<VersionResponse>('createVersion', { params: { id: projectId }, json: body }),
    /** 上傳 .html/.htm/.zip（multipart，欄位名稱 `file`，可附 `entryPage`）。 */
    createVersionFromFile: (projectId: string, file: File, entryPage?: string) => {
      const form = new FormData();
      form.append('file', file, file.name);
      if (entryPage) form.append('entryPage', entryPage);
      return c.request<VersionResponse>('createVersion', { params: { id: projectId }, form });
    },
    /** 再匯入 Review Package ZIP（multipart，欄位名稱 `file`）。 */
    importPackage: (projectId: string, file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return c.request<VersionResponse>('importPackage', { params: { id: projectId }, form });
    },
    getVersion: (id: string) => c.request<VersionDetailResponse>('getVersion', { params: { id } }),
    updateVersion: (id: string, body: { entryPage?: string; cdnAllowlist?: string[] }) =>
      c.request<VersionResponse>('updateVersion', { params: { id }, json: body }),
    deleteVersion: (id: string) => c.request<void>('deleteVersion', { params: { id } }),
    rotateContentKey: (id: string) =>
      c.request<VersionResponse>('rotateContentKey', { params: { id } }),

    listThreads: (versionId: string) =>
      c.request<ThreadsResponse>('listThreads', { params: { id: versionId } }),
    createThread: (versionId: string, body: { anchor: Anchor; body: string; tags?: ThreadTag[] }) =>
      c.request<ThreadResponse>('createThread', { params: { id: versionId }, json: body }),
    updateThread: (id: string, body: { status?: ThreadStatus; tags?: ThreadTag[] }) =>
      c.request<ThreadResponse>('updateThread', { params: { id }, json: body }),
    deleteThread: (id: string) => c.request<void>('deleteThread', { params: { id } }),
    createComment: (threadId: string, body: string) =>
      c.request<ThreadResponse>('createComment', { params: { id: threadId }, json: { body } }),
    updateComment: (id: string, body: string) =>
      c.request<ThreadResponse>('updateComment', { params: { id }, json: { body } }),
    deleteComment: (id: string) =>
      c.request<DeleteCommentResponse>('deleteComment', { params: { id } }),

    listShareLinks: (projectId: string) =>
      c.request<ShareLinksResponse>('listShareLinks', { params: { id: projectId } }),
    createShareLink: (
      projectId: string,
      body: { role: 'commenter' | 'viewer'; expiresAt?: string },
    ) =>
      c.request<CreateShareLinkResponse>('createShareLink', {
        params: { id: projectId },
        json: body,
      }),
    revokeShareLink: (id: string) => c.request<void>('revokeShareLink', { params: { id } }),
    resolveShare: (token: string) =>
      c.request<ShareResolveResponse>('resolveShare', { params: { id: token } }),
    guestIdentity: (token: string, name: string, guestToken?: string) =>
      c.request<GuestIdentityResponse>('guestIdentity', {
        params: { id: token },
        json: { name, ...(guestToken ? { guestToken } : {}) },
      }),

    exportEstimate: (versionId: string) =>
      c.request<ExportEstimateResponse>('exportEstimate', { params: { id: versionId } }),
    exportVersion: (
      versionId: string,
      format: ExportFormat,
      query: ExportQuery = {},
    ): Promise<DownloadResult> =>
      c.download('exportVersion', { params: { id: versionId, format }, query: { ...query } }),
  };
}

export type Api = ReturnType<typeof createApi>;
export const api: Api = createApi(apiClient);
