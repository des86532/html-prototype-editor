import { FRAME_TIMINGS, PROTOCOL_VERSION } from '@hpe/shared';
import type { AgentBridge, AgentModule } from './bridge-types.js';
import { createLeadingThrottle } from './throttle.js';

/** 表單 submit 的提示文字（規格「表單」）。 */
export const FORM_NOTICE_TEXT = '預覽模式不送出表單';

/** 匯出模式的 bundle 內連結解析用的假 origin（只用來做路徑正規化，不會發出請求）。 */
const BUNDLE_ORIGIN = 'https://bundle.invalid';

declare global {
  interface Window {
    /** 單檔匯出的 shell 在載入 prototype 之前設定；匯出模式下 bundle 內連結改送 navigateRequest。 */
    __HPE_EXPORT__?: boolean;
  }
}

export type LinkVerdict =
  { action: 'allow' } | { action: 'block' } | { action: 'navigate'; pageId: string };

/**
 * 判斷一個連結要放行、阻擋，還是（匯出模式）轉成 navigateRequest。
 * `frameOrigin` 是 frame 文件 URL 的 origin（不是 window.origin，後者在 opaque origin 是 "null"）。
 */
export function classifyLink(
  href: string,
  base: string,
  frameOrigin: string,
  pageId: string,
  exportMode: boolean,
): LinkVerdict {
  const raw = href.trim();
  if (/^javascript:/i.test(raw)) return { action: 'allow' };
  if (raw.startsWith('#')) return { action: 'allow' };

  if (exportMode) {
    // 匯出模式：相對路徑 = bundle 內連結。以假 origin 解析並正規化，絕對 URL 一律擋。
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return { action: 'block' };
    const dir = pageId.includes('/') ? pageId.slice(0, pageId.lastIndexOf('/') + 1) : '';
    try {
      const url = new URL(raw, `${BUNDLE_ORIGIN}/${dir}`);
      if (url.origin !== BUNDLE_ORIGIN) return { action: 'block' };
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      return path ? { action: 'navigate', pageId: path } : { action: 'block' };
    } catch {
      return { action: 'block' };
    }
  }

  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return { action: 'block' };
  }
  if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === frameOrigin)
    return { action: 'allow' };
  return { action: 'block' };
}

function findAnchor(event: Event): Element | null {
  for (const node of event.composedPath()) {
    if (
      node instanceof Element &&
      (node.localName === 'a' || node.localName === 'area') &&
      (node.hasAttribute('href') || node.hasAttribute('xlink:href'))
    )
      return node;
  }
  return null;
}

export function installNavGuardOn(win: Window, bridge: AgentBridge): () => void {
  const doc = win.document;
  const formThrottle = createLeadingThrottle(FRAME_TIMINGS.dialogToastThrottleMs);

  const onClick = (event: Event) => {
    const a = findAnchor(event);
    if (!a) return;
    const href = a.getAttribute('href') ?? a.getAttribute('xlink:href') ?? '';
    const verdict = classifyLink(
      href,
      doc.baseURI,
      win.location.origin,
      bridge.pageId(),
      win.__HPE_EXPORT__ === true,
    );
    if (verdict.action === 'allow') return;
    event.preventDefault();
    if (verdict.action === 'navigate')
      bridge.send({ v: PROTOCOL_VERSION, type: 'navigateRequest', pageId: verdict.pageId });
  };
  const notice = () => {
    if (formThrottle())
      bridge.send({ v: PROTOCOL_VERSION, type: 'dialog', kind: 'alert', text: FORM_NOTICE_TEXT });
  };
  // `submit` 事件：沒有 allow-forms 的 sandbox 在「事件觸發之前」就會擋掉送出（HTML 規格的順序），
  // 所以 Chromium 根本不會觸發 submit；Firefox／WebKit 可能會。兩種情況都要處理。
  const onSubmit = (event: Event) => {
    event.preventDefault();
    notice();
  };
  // 因此另外偵測「會送出表單的操作」：點擊 submit 按鈕、在文字欄位按 Enter（implicit submission）。
  const submitterOf = (event: Event): Element | null => {
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) continue;
      const form = (node as HTMLButtonElement | HTMLInputElement).form;
      if (!form) continue;
      if (node.localName === 'button' && (node as HTMLButtonElement).type === 'submit') return node;
      if (node.localName === 'input') {
        const type = (node as HTMLInputElement).type;
        if (type === 'submit' || type === 'image') return node;
      }
    }
    return null;
  };
  const TEXT_INPUTS =
    /^(text|search|email|url|tel|password|number|date|time|datetime-local|month|week)$/;
  const onFormClick = (event: Event) => {
    const el = submitterOf(event);
    if (!el || (el as HTMLButtonElement).disabled) return;
    event.preventDefault();
    notice();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    const el = event.target;
    if (el instanceof HTMLInputElement && el.form && TEXT_INPUTS.test(el.type)) {
      event.preventDefault();
      notice();
    }
  };
  // 程式呼叫的 form.submit()／requestSubmit() 不會有任何事件；包起來顯示提示（不是安全邊界，sandbox 本來就會擋）。
  const proto = HTMLFormElement.prototype;
  const origSubmit = proto?.submit;
  const origRequestSubmit = proto?.requestSubmit;
  if (proto) {
    proto.submit = notice;
    proto.requestSubmit = notice;
  }

  win.addEventListener('click', onClick, true);
  win.addEventListener('auxclick', onClick, true);
  win.addEventListener('submit', onSubmit, true);
  win.addEventListener('click', onFormClick, true);
  win.addEventListener('keydown', onKeyDown, true);
  return () => {
    win.removeEventListener('click', onClick, true);
    win.removeEventListener('auxclick', onClick, true);
    win.removeEventListener('submit', onSubmit, true);
    win.removeEventListener('click', onFormClick, true);
    win.removeEventListener('keydown', onKeyDown, true);
    if (proto && origSubmit && origRequestSubmit) {
      proto.submit = origSubmit;
      proto.requestSubmit = origRequestSubmit;
    }
  };
}

export const installNavGuard: AgentModule = (bridge) => installNavGuardOn(window, bridge);
