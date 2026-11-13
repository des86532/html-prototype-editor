import type { ReactNode } from 'react';

export function StateMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      role="alert"
      className="mx-auto mt-24 max-w-md rounded-lg border border-neutral-200 bg-white p-6 text-center"
    >
      <h1 className="text-lg font-semibold">{title}</h1>
      {children && <div className="mt-2 text-sm text-neutral-600">{children}</div>}
    </div>
  );
}

export function LoadingState({ label = '載入中…' }: { label?: string }) {
  return (
    <p role="status" className="mt-24 text-center text-sm text-neutral-500">
      {label}
    </p>
  );
}
