import { useNavigate } from '@tanstack/react-router';
import { useLogout, useMe } from '@/features/auth/useMe';
import { ProjectList } from '@/features/projects/ProjectList';

export function ProjectsRoute() {
  const navigate = useNavigate();
  const me = useMe();
  const logout = useLogout();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">專案</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-600">{me.data?.name ?? ''}</span>
          <button
            type="button"
            className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
            onClick={() =>
              logout.mutate(undefined, { onSettled: () => void navigate({ to: '/login' }) })
            }
          >
            登出
          </button>
        </div>
      </header>
      <ProjectList
        onOpenProject={(projectId) => void navigate({ to: '/p/$projectId', params: { projectId } })}
      />
    </main>
  );
}
