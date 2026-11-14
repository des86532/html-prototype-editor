import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import { api } from '@/lib/api';
import { isApiError, setShareToken } from '@/lib/apiClient';
import { queryClient } from '@/lib/queryClient';
import { LoginRoute } from '@/routes/LoginRoute';
import { OwnerViewerRoute } from '@/routes/OwnerViewerRoute';
import { ProjectRoute } from '@/routes/ProjectRoute';
import { ProjectsRoute } from '@/routes/ProjectsRoute';
import { ShareRoute } from '@/routes/ShareRoute';
import { LoadingState, StateMessage } from '@/routes/StateMessage';

const rootRoute = createRootRoute({
  component: Outlet,
  pendingComponent: LoadingState,
  errorComponent: ({ error }) => (
    <StateMessage title="無法載入頁面">
      <p className="mb-4">{error instanceof Error ? error.message : '發生未預期的錯誤'}</p>
      <a href="/login" className="btn btn-primary">
        前往登入頁
      </a>
    </StateMessage>
  ),
});

/** 擁有者路由：清掉殘留的分享 token，並要求已登入。 */
async function requireOwner(): Promise<void> {
  setShareToken(null);
  try {
    await queryClient.ensureQueryData({
      queryKey: ['me'],
      queryFn: () => api.me(),
      staleTime: 30_000,
      retry: false,
    });
  } catch (e) {
    if (isApiError(e) && (e.code === 'UNAUTHENTICATED' || e.code === 'NETWORK')) {
      throw redirect({ to: '/login' });
    }
    throw e;
  }
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/projects' });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (s: Record<string, unknown>): { error?: string } =>
    typeof s.error === 'string' && s.error ? { error: s.error } : {},
  beforeLoad: () => setShareToken(null),
  component: LoginRoute,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  beforeLoad: requireOwner,
  component: ProjectsRoute,
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$projectId',
  beforeLoad: requireOwner,
  component: ProjectRoute,
});

export interface ViewerSearch {
  thread?: string;
}
const validateSearch = (s: Record<string, unknown>): ViewerSearch =>
  typeof s.thread === 'string' && s.thread ? { thread: s.thread } : {};

const ownerViewerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$projectId/v/$versionNumber',
  beforeLoad: requireOwner,
  validateSearch,
  component: OwnerViewerRoute,
});

const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/s/$shareToken',
  validateSearch,
  component: ShareRoute,
});

const shareVersionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/s/$shareToken/v/$versionNumber',
  validateSearch,
  component: ShareRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  projectsRoute,
  projectRoute,
  ownerViewerRoute,
  shareRoute,
  shareVersionRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
