import { useCallback, useState } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { Thread } from '@hpe/shared';
import { api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';
import { ExportDialog } from '@/features/export/ExportDialog';
import { PrototypeViewer } from '@/features/viewer/PrototypeViewer';
import { LoadingState, StateMessage } from './StateMessage';

export function OwnerViewerRoute() {
  const { projectId, versionNumber } = useParams({ strict: false }) as {
    projectId: string;
    versionNumber: string;
  };
  const { thread } = useSearch({ strict: false }) as { thread?: string };
  const [exportOpen, setExportOpen] = useState(false);

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
  });
  const version = project.data?.versions.find((v) => v.number === Number(versionNumber));
  const detail = useQuery({
    queryKey: ['version', version?.id],
    queryFn: () => api.getVersion(version!.id),
    enabled: !!version,
  });

  const buildThreadUrl = useCallback(
    (t: Thread) =>
      `${window.location.origin}/p/${encodeURIComponent(projectId)}/v/${encodeURIComponent(versionNumber)}?thread=${encodeURIComponent(t.id)}`,
    [projectId, versionNumber],
  );

  if (project.isLoading || (version && detail.isLoading)) return <LoadingState />;
  if (project.error)
    return <StateMessage title="無法載入專案">{messageForError(project.error)}</StateMessage>;
  if (!version) return <StateMessage title="找不到這個版本" />;
  if (detail.error || !detail.data)
    return <StateMessage title="無法載入版本">{messageForError(detail.error)}</StateMessage>;
  if (detail.data.version.status !== 'ready')
    return (
      <StateMessage title="這個版本尚未就緒">
        狀態：
        {detail.data.version.status === 'rejected'
          ? '已被拒絕'
          : '處理中（請回到專案頁選擇入口頁面）'}
      </StateMessage>
    );

  return (
    <>
      <PrototypeViewer
        key={detail.data.version.id}
        version={detail.data.version}
        projectName={detail.data.project.name}
        actor={{ me: detail.data.me, role: detail.data.role }}
        buildThreadUrl={buildThreadUrl}
        initialThreadId={thread ?? null}
        onExport={() => setExportOpen(true)}
        headerExtra={
          <Link
            to="/p/$projectId"
            params={{ projectId }}
            className="text-sm text-blue-600 underline"
          >
            ← 專案
          </Link>
        }
      />
      <ExportDialog
        versionId={detail.data.version.id}
        projectName={detail.data.project.name}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />
    </>
  );
}
