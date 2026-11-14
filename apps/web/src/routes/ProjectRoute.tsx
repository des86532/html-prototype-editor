import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ProjectDetail } from '@/features/projects/ProjectDetail';

export function ProjectRoute() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const navigate = useNavigate();
  return (
    <main className="mx-auto max-w-4xl p-6">
      <nav className="mb-4 text-sm">
        <Link to="/projects" className="text-blue-600 underline">
          ← 所有專案
        </Link>
      </nav>
      <ProjectDetail
        projectId={projectId}
        onOpenVersion={(versionNumber) =>
          void navigate({
            to: '/p/$projectId/v/$versionNumber',
            params: { projectId, versionNumber: String(versionNumber) },
          })
        }
      />
    </main>
  );
}
