import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './apiClient';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        // 4xx 不重試（權限、找不到、分享連結失效）
        retry: (count, err) =>
          !(isApiError(err) && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  });
}

export const queryClient = createQueryClient();
