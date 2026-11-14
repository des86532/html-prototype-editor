import type { PrototypeVersion } from '@hpe/shared';

/** 測試用 PrototypeVersion 工廠。 */
export function makeVersion(over: Partial<PrototypeVersion> = {}): PrototypeVersion {
  return {
    id: 'v1',
    projectId: 'p1',
    number: 1,
    contentKey: 'k',
    entryPage: 'index.html',
    pages: [{ path: 'index.html', title: null }],
    cdnAllowlist: [],
    analysis: {
      scripts: { inline: 0, external: [] },
      externalResources: [],
      forms: 0,
      passwordInputs: 0,
      iframes: [],
      metaRefresh: false,
      baseTag: false,
      serviceWorkerRegistration: false,
      warnings: [],
    },
    status: 'ready',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}
