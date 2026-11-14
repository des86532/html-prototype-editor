import { useNavigate } from '@tanstack/react-router';
import { ProjectList } from '@/features/projects/ProjectList';
import { AppHeader } from '@/features/ui/AppHeader';

export function ProjectsRoute() {
  const navigate = useNavigate();
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <ProjectList
          onOpenProject={(projectId) =>
            void navigate({ to: '/p/$projectId', params: { projectId } })
          }
        />
      </main>
    </>
  );
}
