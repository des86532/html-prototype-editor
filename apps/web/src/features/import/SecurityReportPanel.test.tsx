import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SecurityReport } from '@hpe/shared';
import { SecurityReportPanel } from './SecurityReportPanel';

afterEach(cleanup);

const empty: SecurityReport = {
  scripts: { inline: 0, external: [] },
  externalResources: [],
  forms: 0,
  passwordInputs: 0,
  iframes: [],
  metaRefresh: false,
  baseTag: false,
  serviceWorkerRegistration: false,
  warnings: [],
};

describe('SecurityReportPanel', () => {
  it('shows empty states and the informational notice', () => {
    render(<SecurityReportPanel report={empty} />);
    expect(screen.getAllByText('無風險項目').length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText(/並非安全邊界/)).toBeInTheDocument();
  });

  it('renders hostile strings as text only', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const { container } = render(
      <SecurityReportPanel
        report={{
          ...empty,
          scripts: { inline: 2, external: [hostile] },
          externalResources: [
            { url: hostile, kind: 'img', blocked: true },
            { url: 'https://cdn.jsdelivr.net/x.js', kind: 'script', blocked: false },
          ],
          iframes: [hostile],
          passwordInputs: 1,
          forms: 3,
          metaRefresh: true,
          baseTag: true,
          serviceWorkerRegistration: true,
          warnings: [hostile],
        }}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText(hostile).length).toBe(4);
    expect(screen.getByText('已封鎖')).toBeInTheDocument();
    expect(screen.getByText('已允許')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('密碼欄位');
    expect(screen.getByText('Service Worker 註冊')).toBeInTheDocument();
  });
});
