import type { ReactNode } from 'react';
import type { SecurityReport } from '@hpe/shared';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h4 className="text-sm font-medium text-slate-800">{title}</h4>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="text-sm text-slate-500">無風險項目</p>;
}

function Badge({ tone, children }: { tone: 'red' | 'green' | 'amber'; children: ReactNode }) {
  const cls =
    tone === 'red'
      ? 'bg-red-100 text-red-800'
      : tone === 'green'
        ? 'bg-green-100 text-green-800'
        : 'bg-amber-100 text-amber-800';
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${cls}`}>{children}</span>;
}

function UrlList({ urls }: { urls: string[] }) {
  return (
    <ul className="space-y-0.5">
      {urls.map((u, i) => (
        <li key={`${i}-${u}`} className="truncate font-mono text-xs text-slate-700">
          {u}
        </li>
      ))}
    </ul>
  );
}

export function SecurityReportPanel({ report }: { report: SecurityReport }) {
  const flags: Array<[string, boolean]> = [
    ['meta refresh 轉址', report.metaRefresh],
    ['<base> 標籤', report.baseTag],
    ['Service Worker 註冊', report.serviceWorkerRegistration],
  ];
  const activeFlags = flags.filter(([, on]) => on);
  return (
    <div className="space-y-3 rounded border border-slate-200 p-4" aria-label="安全性報告">
      <h3 className="text-base font-semibold text-slate-900">安全性報告</h3>
      <p className="text-xs text-slate-500">
        此報告僅供參考，並非安全邊界；原型一律在隔離沙箱中執行。
      </p>

      <Section title="腳本">
        {report.scripts.inline === 0 && report.scripts.external.length === 0 ? (
          <Empty />
        ) : (
          <>
            <p className="text-sm">內嵌腳本：{report.scripts.inline} 個</p>
            {report.scripts.external.length > 0 && <UrlList urls={report.scripts.external} />}
          </>
        )}
      </Section>

      <Section title="外部資源">
        {report.externalResources.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1">
            {report.externalResources.map((r, i) => (
              <li key={`${i}-${r.url}`} className="flex items-center gap-2">
                <Badge tone="amber">{r.kind}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">
                  {r.url}
                </span>
                {r.blocked ? <Badge tone="red">已封鎖</Badge> : <Badge tone="green">已允許</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="表單">
        {report.forms === 0 ? <Empty /> : <p className="text-sm">表單：{report.forms} 個</p>}
      </Section>

      <Section title="密碼欄位">
        {report.passwordInputs === 0 ? (
          <Empty />
        ) : (
          <p role="alert" className="text-sm text-amber-700">
            警告：包含 {report.passwordInputs} 個密碼欄位，請勿輸入真實密碼。
          </p>
        )}
      </Section>

      <Section title="內嵌框架 (iframe)">
        {report.iframes.length === 0 ? <Empty /> : <UrlList urls={report.iframes} />}
      </Section>

      <Section title="其他">
        {activeFlags.length === 0 ? (
          <Empty />
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {activeFlags.map(([label]) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="警告">
        {report.warnings.length === 0 ? (
          <Empty />
        ) : (
          <ul className="list-disc pl-5 text-sm text-amber-800">
            {report.warnings.map((w, i) => (
              <li key={`${i}-${w}`}>{w}</li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
