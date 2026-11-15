import { AUTHOR_PALETTE, hashString, initials } from '@hpe/shared';
import type { LivePeer, LiveState } from './useLiveSession';

const MAX_AVATARS = 5;

export function peerColor(colorKey: string): string {
  return AUTHOR_PALETTE[hashString(colorKey) % AUTHOR_PALETTE.length]!;
}

export interface PresenceBarProps {
  peers: LiveState['peers'];
  selfId: string | null;
  status: LiveState['status'];
  currentPageTitle: (pageId: string) => string;
}

/** 線上成員：排除自己，同一人多分頁只顯示一個。 */
export function PresenceBar({ peers, selfId, status, currentPageTitle }: PresenceBarProps) {
  const seen = new Set<string>();
  const others: LivePeer[] = [];
  for (const p of peers.values()) {
    if (p.id === selfId || seen.has(p.colorKey)) continue;
    seen.add(p.colorKey);
    others.push(p);
  }
  const shown = others.slice(0, MAX_AVATARS);
  const extra = others.length - shown.length;

  return (
    <div className="flex items-center gap-2">
      {shown.length > 0 && (
        <div role="group" aria-label="線上成員" className="flex items-center">
          {shown.map((p) => {
            const label = `${p.name}，在 ${
              p.pageId ? `${currentPageTitle(p.pageId)} · ${p.width ?? '—'}px` : '正在載入'
            }`;
            return (
              <span
                key={p.id}
                role="img"
                aria-label={label}
                title={label}
                className="-ml-1.5 flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-surface first:ml-0"
                style={{ background: peerColor(p.colorKey) }}
              >
                {initials(p.name)}
              </span>
            );
          })}
          {extra > 0 && (
            <span className="-ml-1.5 flex size-7 items-center justify-center rounded-full bg-line-strong text-[11px] font-semibold text-ink ring-2 ring-surface">
              +{extra}
            </span>
          )}
        </div>
      )}
      {status === 'reconnecting' && <span className="chip chip-warn">重新連線中…</span>}
      {status === 'closed' && <span className="chip chip-muted">即時協作已中斷</span>}
    </div>
  );
}
