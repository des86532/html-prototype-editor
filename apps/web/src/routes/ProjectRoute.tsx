import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ProjectDetail } from '@/features/projects/ProjectDetail';
import { AppHeader } from '@/features/ui/AppHeader';

export function ProjectRoute() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const navigate = useNavigate();
  return (
    <>
      <AppHeader>
        <Link to="/projects" className="link text-sm">
          ← 所有專案
        </Link>
      </AppHeader>
      <main className="mx-auto max-w-5xl px-6 py-10">
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
    </>
  );
}
