import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearch } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Thread } from '@hpe/shared';
import { api } from '@/lib/api';
import { getGuestToken, setGuestToken, setShareToken } from '@/lib/apiClient';
import { messageForError } from '@/lib/errorMessages';
import { GuestIdentityPrompt } from '@/features/share/GuestIdentityPrompt';
import { PrototypeViewer } from '@/features/viewer/PrototypeViewer';
import { LoadingState, StateMessage } from './StateMessage';

/** `/s/:shareToken` 與 `/s/:shareToken/v/:versionNumber`。 */
export function ShareRoute() {
  const { shareToken, versionNumber } = useParams({ strict: false }) as {
    shareToken: string;
    versionNumber?: string;
  };
  const { thread } = useSearch({ strict: false }) as { thread?: string };
  const qc = useQueryClient();
  // 以 effect 設定（不只在 queryFn 內）：元件重新掛載時 cleanup 會清掉 token，但 resolveShare 已有快取、
  // 不會再跑 queryFn，之後的請求就會變成匿名（401）。queryFn 內仍會設定，確保第一個請求就帶 token。
  useEffect(() => {
    setShareToken(shareToken);
    return () => setShareToken(null);
  }, [shareToken]);

  const resolved = useQuery({
    queryKey: ['share', shareToken],
    queryFn: () => {
      setShareToken(shareToken);
      return api.resolveShare(shareToken);
    },
    retry: false,
  });

  const versions = resolved.data?.versions ?? [];
  const version = versionNumber
    ? versions.find((v) => v.number === Number(versionNumber))
    : [...versions].filter((v) => v.status === 'ready').sort((a, b) => b.number - a.number)[0];

  const detail = useQuery({
    queryKey: ['version', version?.id, 'share', shareToken],
    queryFn: () => api.getVersion(version!.id),
    enabled: !!version,
  });

  const [guest, setGuest] = useState<{ guestId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitName = useCallback(
    async (name: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await api.guestIdentity(
          shareToken,
          name,
          getGuestToken(shareToken) ?? undefined,
        );
        setGuestToken(shareToken, res.guestToken);
        setGuest(res.guest);
        await qc.invalidateQueries({ queryKey: ['version'] });
      } catch (e) {
        setError(messageForError(e));
      } finally {
        setBusy(false);
      }
    },
    [shareToken, qc],
  );

  const buildThreadUrl = useCallback(
    (t: Thread) =>
      `${window.location.origin}/s/${encodeURIComponent(shareToken)}${
        version ? `/v/${version.number}` : ''
      }?thread=${encodeURIComponent(t.id)}`,
    [shareToken, version],
  );

  if (resolved.isLoading || (version && detail.isLoading)) return <LoadingState />;
  if (resolved.error)
    return <StateMessage title="無法開啟分享連結">{messageForError(resolved.error)}</StateMessage>;
  if (!version) return <StateMessage title="這個專案還沒有可檢視的版本" />;
  if (detail.error || !detail.data)
    return <StateMessage title="無法載入版本">{messageForError(detail.error)}</StateMessage>;
  if (detail.data.version.status !== 'ready') return <StateMessage title="這個版本尚未就緒" />;

  const role = detail.data.role;
  const me = detail.data.me ?? (guest ? { kind: 'guest' as const, ...guest } : null);

  return (
    <>
      <PrototypeViewer
        key={detail.data.version.id}
        version={detail.data.version}
        projectName={detail.data.project.name}
        actor={{ me, role }}
        buildThreadUrl={buildThreadUrl}
        initialThreadId={thread ?? null}
      />
      {role === 'commenter' && me === null && (
        <GuestIdentityPrompt onSubmit={(name) => void submitName(name)} busy={busy} error={error} />
      )}
    </>
  );
}
