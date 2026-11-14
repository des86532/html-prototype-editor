import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CDN_PRESETS } from '@hpe/shared';
import { api as defaultApi, type Api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';

export interface CdnAllowlistPickerProps {
  versionId: string;
  value: string[];
  api?: Api;
  onChange?: (next: string[]) => void;
}

const isChecked = (preset: (typeof CDN_PRESETS)[number], origins: string[]) =>
  preset.origins.every((o) => origins.includes(o));

export function CdnAllowlistPicker({
  versionId,
  value,
  api = defaultApi,
  onChange,
}: CdnAllowlistPickerProps) {
  const qc = useQueryClient();
  // 樂觀更新只在對應的 `value` 仍是同一份時有效；父層取得新資料後即回到 `value`。
  const [optimistic, setOptimistic] = useState<{ base: string[]; next: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = optimistic && optimistic.base === value ? optimistic.next : value;

  const mutation = useMutation({
    mutationFn: (next: string[]) => api.updateVersion(versionId, { cdnAllowlist: next }),
  });

  const toggle = (presetId: string, checked: boolean) => {
    const ids = new Set<string>(CDN_PRESETS.filter((p) => isChecked(p, current)).map((p) => p.id));
    if (checked) ids.add(presetId);
    else ids.delete(presetId);
    const next = Array.from(
      new Set(CDN_PRESETS.filter((p) => ids.has(p.id)).flatMap((p) => [...p.origins])),
    );
    setOptimistic({ base: value, next });
    setError(null);
    mutation.mutate(next, {
      onSuccess: () => {
        onChange?.(next);
        void qc.invalidateQueries({ queryKey: ['version', versionId] });
        void qc.invalidateQueries({ queryKey: ['project'] });
      },
      onError: (e) => {
        setOptimistic(null);
        setError(messageForError(e));
      },
    });
  };

  return (
    <fieldset className="card space-y-2 p-4">
      <legend className="px-1 text-sm font-medium text-ink">允許的 CDN</legend>
      <p className="text-xs text-ink-3">勾選後，原型可載入這些來源的外部資源。</p>
      {CDN_PRESETS.map((p) => (
        <label key={p.id} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={isChecked(p, current)}
            onChange={(e) => toggle(p.id, e.target.checked)}
            className="mt-1"
          />
          <span>
            {p.label}
            <span className="block font-mono text-xs text-ink-3">{p.origins.join('、')}</span>
          </span>
        </label>
      ))}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
