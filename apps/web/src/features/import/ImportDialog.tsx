import { useId, useRef, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UPLOAD_LIMITS, type PrototypeVersion } from '@hpe/shared';
import { api as defaultApi, type Api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';
import { Modal } from '@/features/ui/Modal';
import { CdnAllowlistPicker } from './CdnAllowlistPicker';
import { SecurityReportPanel } from './SecurityReportPanel';

export interface ImportDialogProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onImported: (version: PrototypeVersion) => void;
  api?: Api;
}

type Tab = 'file' | 'paste';

const ACCEPT = '.html,.htm,.zip';
const EXT_ERROR = '僅支援 .html、.htm 或 .zip 檔案。';

export function precheckFile(file: File): string | null {
  const m = /\.([^./\\]+)$/.exec(file.name.toLowerCase());
  const ext = m?.[1];
  if (ext !== 'html' && ext !== 'htm' && ext !== 'zip') return EXT_ERROR;
  const max = ext === 'zip' ? UPLOAD_LIMITS.maxArchiveBytes : UPLOAD_LIMITS.maxSingleHtmlBytes;
  if (file.size > max) {
    return messageForError({
      code: ext === 'zip' ? 'IMPORT_ARCHIVE_TOO_LARGE' : 'IMPORT_EXTRACTED_TOO_LARGE',
    });
  }
  return null;
}

function candidatesFromError(e: unknown): string[] | null {
  if ((e as { code?: unknown } | null)?.code !== 'IMPORT_ENTRY_REQUIRED') return null;
  const c = (e as { details?: { candidates?: unknown } }).details?.candidates;
  return Array.isArray(c) && c.every((x) => typeof x === 'string') ? (c as string[]) : [];
}

function entryCandidatesOf(v: PrototypeVersion): string[] | null {
  const list = v.entryCandidates ?? [];
  if (list.length > 0 && (v.entryPage === '' || v.status === 'processing')) return list;
  if (v.entryPage === '') return v.pages.map((p) => p.path);
  return null;
}

function ImportBody({
  projectId,
  onClose,
  onImported,
  api = defaultApi,
}: Omit<ImportDialogProps, 'open'>) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('file');
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** 伺服器回傳 IMPORT_ENTRY_REQUIRED：尚未建立版本，需帶入口重新送出。 */
  const [retryCandidates, setRetryCandidates] = useState<string[] | null>(null);
  /** 已建立但尚未決定入口的版本。 */
  const [pending, setPending] = useState<{
    version: PrototypeVersion;
    candidates: string[];
  } | null>(null);
  const [entry, setEntry] = useState('');
  const [done, setDone] = useState<PrototypeVersion | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteId = useId();

  const finish = (v: PrototypeVersion) => {
    setDone(v);
    void qc.invalidateQueries({ queryKey: ['project', projectId] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
  };

  const submitMutation = useMutation({
    mutationFn: (entryPage?: string) => {
      if (tab === 'file') {
        if (!file) throw new Error('no file');
        return api.createVersionFromFile(projectId, file, entryPage);
      }
      return api.createVersionFromSource(projectId, {
        html: source,
        ...(entryPage ? { entryPage } : {}),
      });
    },
    onSuccess: ({ version }) => {
      setRetryCandidates(null);
      const candidates = entryCandidatesOf(version);
      if (candidates) {
        setPending({ version, candidates });
        setEntry(candidates[0] ?? '');
      } else {
        finish(version);
      }
    },
    onError: (e) => {
      const c = candidatesFromError(e);
      if (c) {
        setRetryCandidates(c);
        setEntry(c[0] ?? '');
        setError(null);
      } else {
        setError(messageForError(e));
      }
    },
  });

  const entryMutation = useMutation({
    mutationFn: ({ id, entryPage }: { id: string; entryPage: string }) =>
      api.updateVersion(id, { entryPage }),
    onSuccess: ({ version }) => {
      setPending(null);
      finish(version);
    },
    onError: (e) => setError(messageForError(e)),
  });

  const busy = submitMutation.isPending || entryMutation.isPending;

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const problem = precheckFile(f);
    setError(problem);
    setRetryCandidates(null);
    setFile(problem ? null : f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files[0]);
  };

  const submit = () => {
    setError(null);
    if (tab === 'file') {
      if (!file) return setError('請先選擇檔案。');
    } else {
      if (!source.trim()) return setError('請貼上 HTML 原始碼。');
      if (new TextEncoder().encode(source).length > UPLOAD_LIMITS.maxSingleHtmlBytes) {
        return setError(messageForError({ code: 'IMPORT_EXTRACTED_TOO_LARGE' }));
      }
    }
    submitMutation.mutate(undefined);
  };

  const confirmEntry = () => {
    if (!entry) return;
    setError(null);
    if (pending) entryMutation.mutate({ id: pending.version.id, entryPage: entry });
    else submitMutation.mutate(entry);
  };

  const chooserCandidates = pending?.candidates ?? retryCandidates;

  return (
    <>
      {done ? (
        <div className="space-y-4">
          <p role="status" className="text-sm text-ok">
            已匯入 v{done.number}。
          </p>
          <SecurityReportPanel report={done.analysis} />
          <CdnAllowlistPicker
            versionId={done.id}
            value={done.cdnAllowlist}
            api={api}
            onChange={(next) => setDone({ ...done, cdnAllowlist: next })}
          />
          <div className="flex justify-end">
            <button type="button" onClick={() => onImported(done)} className="btn btn-primary">
              完成
            </button>
          </div>
        </div>
      ) : chooserCandidates ? (
        <fieldset className="space-y-3">
          <legend className="field-label">請選擇入口頁面</legend>
          {chooserCandidates.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="entry-page"
                value={c}
                checked={entry === c}
                onChange={() => setEntry(c)}
              />
              <span className="truncate font-mono">{c}</span>
            </label>
          ))}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy || !entry}
              onClick={confirmEntry}
              className="btn btn-primary"
            >
              {busy ? '處理中…' : '確認入口'}
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="space-y-4">
          <div role="tablist" aria-label="匯入方式" className="flex gap-2 border-b border-line">
            {(
              [
                ['file', '上傳檔案'],
                ['paste', '貼上原始碼'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => {
                  setTab(id);
                  setError(null);
                }}
                className={`px-3 py-2 text-sm ${tab === id ? 'border-b-2 border-accent font-medium text-accent' : 'text-ink-2'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'file' ? (
            <div
              role="tabpanel"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center ${dragging || file ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-paper'}`}
            >
              <p className="text-sm text-ink-2">拖放 .html / .htm / .zip 到這裡，或</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-secondary"
              >
                選擇檔案
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                aria-label="選擇檔案"
                className="hidden"
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {file && <p className="text-sm text-ink">已選擇：{file.name}</p>}
            </div>
          ) : (
            <div role="tabpanel" className="space-y-1">
              <label htmlFor={pasteId} className="field-label">
                HTML 原始碼
              </label>
              <textarea
                id={pasteId}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                rows={12}
                className="input h-auto py-2 font-mono text-xs"
              />
            </div>
          )}

          {busy && (
            <div role="status" aria-live="polite" className="space-y-1">
              <p className="text-sm text-ink-2">上傳並分析中…</p>
              <div className="h-1.5 w-full animate-pulse rounded bg-accent" />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost">
              取消
            </button>
            <button type="button" disabled={busy} onClick={submit} className="btn btn-primary">
              匯入
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function ImportDialog({ open, ...rest }: ImportDialogProps) {
  return (
    <Modal open={open} title="匯入新版本" onClose={rest.onClose} widthClass="max-w-2xl">
      <ImportBody {...rest} />
    </Modal>
  );
}
