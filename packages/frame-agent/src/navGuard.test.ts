import type { AgentBridge } from './bridge-types.js';
import type { FrameToParent } from '@hpe/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyLink, installNavGuardOn, FORM_NOTICE_TEXT } from './navGuard.js';

const ORIGIN = 'http://key.content.localhost:5174';
const BASE = `${ORIGIN}/sub/page.html`;

describe('classifyLink (normal mode)', () => {
  const c = (href: string) => classifyLink(href, BASE, ORIGIN, 'sub/page.html', false).action;
  it('allows in-bundle, hash and javascript: links', () => {
    expect(c('other.html')).toBe('allow');
    expect(c('/x/y.html')).toBe('allow');
    expect(c(`${ORIGIN}/a.html`)).toBe('allow');
    expect(c('#top')).toBe('allow');
    expect(c('javascript:void(0)')).toBe('allow');
  });
  it('blocks external, protocol-relative, other schemes', () => {
    expect(c('https://evil.example/')).toBe('block');
    expect(c('//evil.example/x')).toBe('block');
    expect(c('http://key.content.localhost:9999/')).toBe('block');
    expect(c('mailto:a@b.c')).toBe('block');
    expect(c('data:text/html,x')).toBe('block');
    expect(c('  HTTPS://evil.example')).toBe('block');
  });
});

describe('classifyLink (export mode)', () => {
  const c = (href: string, page = 'sub/page.html') =>
    classifyLink(href, 'about:srcdoc', 'null', page, true);
  it('turns relative links into bundle page ids', () => {
    expect(c('other.html')).toEqual({ action: 'navigate', pageId: 'sub/other.html' });
    expect(c('../index.html?x=1#y')).toEqual({ action: 'navigate', pageId: 'index.html' });
    expect(c('/root.html')).toEqual({ action: 'navigate', pageId: 'root.html' });
    expect(c('a%20b.html', 'index.html')).toEqual({ action: 'navigate', pageId: 'a b.html' });
  });
  it('blocks absolute URLs, keeps hash links', () => {
    expect(c('https://evil.example/').action).toBe('block');
    expect(c('//evil.example/').action).toBe('block');
    expect(c('mailto:x@y.z').action).toBe('block');
    expect(c('#x').action).toBe('allow');
  });
});

describe('installNavGuardOn', () => {
  let sent: FrameToParent[];
  let dispose: () => void;
  const bridge: AgentBridge = {
    send: (m) => sent.push(m),
    subscribe: () => () => {},
    pageId: () => 'index.html',
  };
  beforeEach(() => {
    sent = [];
    document.body.replaceChildren();
    dispose = installNavGuardOn(window, bridge);
  });
  afterEach(() => {
    dispose();
    delete window.__HPE_EXPORT__;
  });

  const click = (el: Element) => {
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const link = (href: string) => {
    const a = document.createElement('a');
    a.setAttribute('href', href);
    const span = document.createElement('span');
    a.append(span);
    document.body.append(a);
    return span;
  };

  it('blocks external links (also via a nested child) and lets in-bundle links through', () => {
    expect(click(link('https://evil.example/x'))).toBe(true);
    expect(click(link('next.html'))).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('export mode: in-bundle links become navigateRequest', () => {
    window.__HPE_EXPORT__ = true;
    expect(click(link('pricing.html'))).toBe(true);
    expect(sent).toEqual([{ v: 1, type: 'navigateRequest', pageId: 'pricing.html' }]);
  });

  it('prevents form submit and sends a throttled notice', () => {
    const form = document.createElement('form');
    document.body.append(form);
    const submit = () => {
      const ev = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(submit()).toBe(true);
    expect(submit()).toBe(true);
    expect(sent).toEqual([{ v: 1, type: 'dialog', kind: 'alert', text: FORM_NOTICE_TEXT }]);
  });

  it('also notices when a submit button is clicked (sandboxed frames never fire submit)', () => {
    const form = document.createElement('form');
    const btn = document.createElement('button');
    form.append(btn);
    document.body.append(form);
    expect(click(btn)).toBe(true);
    expect(sent).toHaveLength(1);
    // type=button 不是 submit，不處理
    const plain = document.createElement('button');
    plain.type = 'button';
    form.append(plain);
    expect(click(plain)).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('notices implicit submission via Enter in a text input, ignores other keys', () => {
    const form = document.createElement('form');
    const input = document.createElement('input');
    form.append(input);
    document.body.append(form);
    const key = (k: string) => {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      input.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(key('a')).toBe(false);
    expect(key('Enter')).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('wraps form.submit() and requestSubmit() and restores them on dispose', () => {
    dispose();
    const original = HTMLFormElement.prototype.submit;
    dispose = installNavGuardOn(window, bridge);
    expect(HTMLFormElement.prototype.submit).not.toBe(original);
    const form = document.createElement('form');
    document.body.append(form);
    form.submit();
    form.requestSubmit();
    expect(sent).toHaveLength(1); // 第二次在節流視窗內
    dispose();
    expect(HTMLFormElement.prototype.submit).toBe(original);
  });
});
