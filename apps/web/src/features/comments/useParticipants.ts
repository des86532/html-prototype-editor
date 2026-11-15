import { useQuery } from '@tanstack/react-query';
import { api as defaultApi, type Api } from '@/lib/api';

export const participantsKey = (versionId: string) => ['participants', versionId] as const;

/** 專案的可提及成員（擁有者、留過言或畫過標記的人）。失敗時視為空清單，不影響留言。 */
export function useParticipants(versionId: string, api: Api = defaultApi) {
  return useQuery({
    queryKey: participantsKey(versionId),
    queryFn: () => api.listParticipants(versionId),
    select: (r) => r.participants,
    retry: false,
  });
}
