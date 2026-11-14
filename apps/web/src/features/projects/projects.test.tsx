import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '@/lib/api';
import { makeVersion } from '@/features/import/fixtures';
import { ProjectDetail } from './ProjectDetail';
import { ProjectList } from './ProjectList';
import { ProjectSettings } from './ProjectSettings';

afterEach(cleanup);

const project = {
  id: 'p1',
  name: '<b>Proto</b>',
  ownerId: 'u1',
  createdAt: '2026-01-01T00:00:00Z',
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ProjectList', () => {
  it('lists, creates, and deletes with inline confirm; names are plain text', async () => {
    const listProjects = vi.fn().mockResolvedValue({ projects: [project] });
    const createProject = vi.fn().mockResolvedValue({ project: { ...project, id: 'p2' } });
    const deleteProject = vi.fn().mockResolvedValue(undefined);
    const onOpenProject = vi.fn();
    const { container } = wrap(
      <ProjectList
        onOpenProject={onOpenProject}
        api={{ listProjects, createProject, deleteProject } as unknown as Api}
      />,
    );
    expect(await screen.findByText('<b>Proto</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
    await userEvent.click(screen.getByText('<b>Proto</b>'));
    expect(onOpenProject).toHaveBeenCalledWith('p1');

    await userEvent.type(screen.getByLabelText('新專案名稱'), ' New ');
    await userEvent.click(screen.getByRole('button', { name: '建立專案' }));
    await waitFor(() => expect(createProject).toHaveBeenCalledWith('New'));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('p2'));

    await userEvent.click(screen.getByRole('button', { name: /^刪除/ }));
    expect(deleteProject).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '確認刪除' }));
    expect(deleteProject).toHaveBeenCalledWith('p1');
  });
});

describe('ProjectDetail', () => {
  it('shows versions, opens, expands report, deletes', async () => {
    const v = makeVersion({ id: 'v1', number: 3 });
    const getProject = vi.fn().mockResolvedValue({ project, versions: [v] });
    const deleteVersion = vi.fn().mockResolvedValue(undefined);
    const onOpenVersion = vi.fn();
    wrap(
      <ProjectDetail
        projectId="p1"
        onOpenVersion={onOpenVersion}
        api={{ getProject, deleteVersion } as unknown as Api}
      />,
    );
    expect(await screen.findByText('v3')).toBeInTheDocument();
    expect(screen.getByText('1 頁')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '開啟 v3' }));
    expect(onOpenVersion).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole('button', { name: /安全性與 CDN/ }));
    expect(screen.getByText('安全性報告')).toBeInTheDocument();
    expect(screen.getByText('允許的 CDN')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '刪除 v3' }));
    await userEvent.click(screen.getByRole('button', { name: '確認刪除' }));
    expect(deleteVersion).toHaveBeenCalledWith('v1');
    await userEvent.click(screen.getByRole('button', { name: '匯入新版本' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('ProjectSettings', () => {
  it('deletes project after confirm and calls onDeleted', async () => {
    const getProject = vi.fn().mockResolvedValue({ project, versions: [] });
    const deleteProject = vi.fn().mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    wrap(
      <ProjectSettings
        projectId="p1"
        onDeleted={onDeleted}
        api={{ getProject, deleteProject } as unknown as Api}
      />,
    );
    await screen.findByText('<b>Proto</b>');
    await userEvent.click(screen.getByRole('button', { name: '刪除專案' }));
    await userEvent.click(screen.getByRole('button', { name: '確認刪除專案' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(deleteProject).toHaveBeenCalledWith('p1');
  });
});
