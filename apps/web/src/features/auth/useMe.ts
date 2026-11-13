import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@hpe/shared';
import { api as defaultApi, type Api } from '@/lib/api';

export const ME_KEY = ['me'] as const;

/** 目前登入者；未登入回傳 null（不重試）。 */
export function useMe(api: Api = defaultApi) {
  return useQuery<User | null>({
    queryKey: ME_KEY,
    retry: false,
    queryFn: async () => {
      try {
        return (await api.me()).user;
      } catch (e) {
        if ((e as { code?: unknown } | null)?.code === 'UNAUTHENTICATED') return null;
        throw e;
      }
    },
  });
}

export function useLogout(api: Api = defaultApi) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      qc.setQueryData(ME_KEY, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
  });
}
