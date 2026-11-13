import { PROTOCOL_VERSION } from '@hpe/shared';
import { createBridge } from './bridge.js';
import type { AgentBridge, AgentModule } from './bridge-types.js';
import { installHeartbeat } from './heartbeat.js';
import { installGeometry } from './geometry.js';
import { installNavGuard } from './navGuard.js';
import { installPicker } from './picker.js';
import { installPolyfills } from './polyfills.js';

export const AGENT_VERSION = '1.0.0';

const INSTALLED = Symbol.for('hpe.frame-agent.installed');

/** 送出 `ready`：DOMContentLoaded、load、hashchange 各送一次（parent 的 watchdog 以 iframe load 後的 ready 為準）。 */
function installReady(bridge: AgentBridge): () => void {
  const sendReady = () => {
    const de = document.documentElement;
    bridge.send({
      v: PROTOCOL_VERSION,
      type: 'ready',
      agentVersion: AGENT_VERSION,
      pageId: bridge.pageId(),
      hash: location.hash.slice(0, 512),
      docSize: { w: de.scrollWidth, h: de.scrollHeight },
    });
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', sendReady, { once: true });
  else sendReady();
  // load 事件與 iframe 元素的 load 在同一個 task，所以這次 ready 一定晚於 parent 端的 load。
  if (document.readyState !== 'complete')
    window.addEventListener('load', sendReady, { once: true });
  window.addEventListener('hashchange', sendReady);
  return () => {
    window.removeEventListener('load', sendReady);
    window.removeEventListener('hashchange', sendReady);
    document.removeEventListener('DOMContentLoaded', sendReady);
  };
}

export function installAgent(): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[INSTALLED]) return;
  Object.defineProperty(g, INSTALLED, { value: true });

  const bridge = createBridge(window);
  const modules: AgentModule[] = [
    installHeartbeat,
    installPolyfills,
    installNavGuard,
    installPicker,
    installGeometry,
  ];

  for (const install of modules) {
    try {
      install(bridge);
    } catch {
      /* 單一模組安裝失敗不影響其他模組 */
    }
  }
  installReady(bridge);
}

installAgent();
