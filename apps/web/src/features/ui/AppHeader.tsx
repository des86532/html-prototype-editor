import type { ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useLogout, useMe } from '@/features/auth/useMe';
import { CropMarks } from './CropMarks';

/** 擁有者頁面共用的頂列：品牌、麵包屑（children）、使用者與登出。 */
export function AppHeader({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const me = useMe();
  const logout = useLogout();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-6">
        <Link to="/projects" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="relative size-4 [&_.crop-marks]:inset-0">
            <CropMarks />
          </span>
          HTML Prototype Editor
        </Link>
        {children}
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-ink-2">{me.data?.name ?? ''}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              logout.mutate(undefined, { onSettled: () => void navigate({ to: '/login' }) })
            }
          >
            登出
          </button>
        </div>
      </div>
    </header>
  );
}
