import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PrototypeVersion } from '@hpe/shared';
import { api as defaultApi, type Api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';
import { ImportDialog } from '@/features/import/ImportDialog';
import { SecurityReportPanel } from '@/features/import/SecurityReportPanel';
import { CdnAllowlistPicker } from '@/features/import/CdnAllowlistPicker';
import { ShareDialog } from '@/features/share/ShareDialog';
import { ExportDialog } from '@/features/export/ExportDialog';

export interface ProjectDetailProps {
  projectId: string;
  onOpenVersion: (versionNumber: number) => void;
  api?: Api;
}

const STATUS_LABEL: Record<PrototypeVersion['status'], string> = {
  processing: '處理中',
  ready: '就緒',
  rejected: '已拒絕',
};

const STATUS_CHIP: Record<PrototypeVersion['status'], string> = {
  processing: 'chip-warn',
  ready: 'chip-ok',
  rejected: 'chip-danger',
};

export function ProjectDetail({ projectId, onOpenVersion, api = defaultApi }: ProjectDetailProps) {
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportVersionId, setExportVersionId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['project', projectId] });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteVersion(id),
    onSuccess: () => {
      setConfirmDelete(null);
      setError(null);
      void refresh();
    },
    onError: (e) => setError(messageForError(e)),
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api.rotateContentKey(id),
    onSuccess: (_r, id) => {
      setConfirmRotate(null);
      setError(null);
      void refresh();
      void qc.invalidateQueries({ queryKey: ['version', id] });
    },
    onError: (e) => setError(messageForError(e)),
  });

  if (detail.isPending) return <p className="text-sm text-ink-3">載入中…</p>;
  if (detail.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {messageForError(detail.error)}
      </p>
    );
  }

  const { project, versions } = detail.data;
  const exportVersion = versions.find((v) => v.id === exportVersionId);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight text-ink">
          {project.name}
        </h1>
        <button type="button" onClick={() => setImportOpen(true)} className="btn btn-primary">
          匯入新版本
        </button>
        <button type="button" onClick={() => setShareOpen(true)} className="btn btn-secondary">
          分享
        </button>
      </header>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {versions.length === 0 ? (
        <p className="text-sm text-ink-3">尚無版本，請先匯入原型。</p>
      ) : (
        <ul className="space-y-3">
          {versions.map((v) => (
            <li key={v.id} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="font-mono text-lg font-medium text-ink">v{v.number}</span>
                <span className={`chip ${STATUS_CHIP[v.status]}`}>{STATUS_LABEL[v.status]}</span>
                <span className="text-sm text-ink-3">
                  {new Date(v.createdAt).toLocaleString('zh-TW')}
                </span>
                <span className="font-mono text-sm text-ink-3">{v.pages.length} 頁</span>
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-label={`開啟 v${v.number}`}
                    onClick={() => onOpenVersion(v.number)}
                    className="btn btn-primary btn-sm"
                  >
                    開啟
                  </button>
                  <button
                    type="button"
                    aria-expanded={expanded === v.id}
                    aria-label={`安全性與 CDN 設定 v${v.number}`}
                    onClick={() => setExpanded(expanded === v.id ? null : v.id)}
                    className="btn btn-secondary btn-sm"
                  >
                    安全性與 CDN
                  </button>
                  <button
                    type="button"
                    aria-label={`匯出 v${v.number}`}
                    onClick={() => setExportVersionId(v.id)}
                    className="btn btn-secondary btn-sm"
                  >
                    匯出
                  </button>
                  {confirmRotate === v.id ? (
                    <span className="flex items-center gap-1 text-xs text-ink-2">
                      <span>舊的內容網址將失效，確定？</span>
                      <button
                        type="button"
                        disabled={rotate.isPending}
                        onClick={() => rotate.mutate(v.id)}
                        className="btn btn-warn-solid btn-sm"
                      >
                        確認輪替
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRotate(null)}
                        className="btn btn-ghost btn-sm"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`輪替內容金鑰 v${v.number}`}
                      onClick={() => setConfirmRotate(v.id)}
                      className="btn btn-secondary btn-sm"
                    >
                      輪替內容金鑰
                    </button>
                  )}
                  {confirmDelete === v.id ? (
                    <span className="flex items-center gap-1 text-xs text-ink-2">
                      <span>確定刪除 v{v.number}？</span>
                      <button
                        type="button"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(v.id)}
                        className="btn btn-danger-solid btn-sm"
                      >
                        確認刪除
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="btn btn-ghost btn-sm"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`刪除 v${v.number}`}
                      onClick={() => setConfirmDelete(v.id)}
                      className="btn btn-danger btn-sm"
                    >
                      刪除
                    </button>
                  )}
                </span>
              </div>
              {expanded === v.id && (
                <div className="space-y-3 rounded-md border border-line bg-paper p-3">
                  <SecurityReportPanel report={v.analysis} />
                  <CdnAllowlistPicker versionId={v.id} value={v.cdnAllowlist} api={api} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ImportDialog
        projectId={projectId}
        open={importOpen}
        api={api}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setImportOpen(false);
          void refresh();
        }}
      />
      <ShareDialog
        projectId={projectId}
        open={shareOpen}
        api={api}
        onClose={() => setShareOpen(false)}
      />
      {exportVersion && (
        <ExportDialog
          versionId={exportVersion.id}
          projectName={project.name}
          open
          api={api}
          onClose={() => setExportVersionId(null)}
        />
      )}
    </section>
  );
}
