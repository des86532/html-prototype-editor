import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AgentInjector, agentTag, injectAgentBuffer } from './injectAgent.js';

const TAG = agentTag('index.html');
const inject = async (html: string | Buffer, page = 'index.html') =>
  (await injectAgentBuffer(html, page)).toString('utf8');

describe('injectAgent', () => {
  it('tag shape and attribute escaping', () => {
    expect(TAG).toBe('<script src="/__hpe/agent.v1.js" data-hpe-page="index.html"></script>');
    expect(agentTag('a"><img src=x onerror=1>&\'.html')).toBe(
      '<script src="/__hpe/agent.v1.js" data-hpe-page="a&#34;&#62;&#60;img src=x onerror=1&#62;&#38;&#39;.html"></script>',
    );
  });

  it('inserts as the first child of an existing <head>', async () => {
    expect(
      await inject('<!doctype html><html><head><title>x</title></head><body></body></html>'),
    ).toBe(`<!doctype html><html><head>${TAG}<title>x</title></head><body></body></html>`);
  });

  it('handles uppercase tags and attributes on <head>', async () => {
    expect(
      await inject('<!DOCTYPE html>\n<HTML LANG=zh>\n<HEAD profile="x" >\n<META charset=utf-8>'),
    ).toBe(`<!DOCTYPE html>\n<HTML LANG=zh>\n<HEAD profile="x" >${TAG}\n<META charset=utf-8>`);
  });

  it('creates <head> before <body> when <html> has no head', async () => {
    expect(await inject('<!doctype html><html lang="x"><body>hi</body></html>')).toBe(
      `<!doctype html><html lang="x"><head>${TAG}</head><body>hi</body></html>`,
    );
  });

  it('creates <head> at the first element when there is no <html> either', async () => {
    expect(await inject('<!doctype html>\n<div>hi</div>')).toBe(
      `<!doctype html>\n<head>${TAG}</head><div>hi</div>`,
    );
    expect(await inject('<script>var a</script>')).toBe(
      `<head>${TAG}</head><script>var a</script>`,
    );
  });

  it('creates <head> before bare text', async () => {
    expect(await inject('hello <b>x')).toBe(`<head>${TAG}</head>hello <b>x`);
  });

  it('ignores a <head> that only appears inside a comment, script or attribute', async () => {
    const out = await inject('<!-- <head> --><html><body><script>"<head>"</script></body></html>');
    expect(out).toBe(
      `<!-- <head> --><html><head>${TAG}</head><body><script>"<head>"</script></body></html>`,
    );
    const out2 = await inject('<p title="<head>">x</p>');
    expect(out2).toBe(`<head>${TAG}</head><p title="<head>">x</p>`);
  });

  it('leaves comments, doctype and whitespace before the insertion point alone', async () => {
    expect(
      await inject('<!-- c -->\n<!doctype html>\n<!-- d -->\n<html>\n<!-- e -->\n<head>'),
    ).toBe(`<!-- c -->\n<!doctype html>\n<!-- d -->\n<html>\n<!-- e -->\n<head>${TAG}`);
  });

  it('keeps a UTF-8 BOM first and inserts after it', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const out = await injectAgentBuffer(
      Buffer.concat([bom, Buffer.from('<html><head></head>')]),
      'a.html',
    );
    expect(out.subarray(0, 3)).toEqual(bom);
    expect(out.subarray(3).toString()).toBe(`<html><head>${agentTag('a.html')}</head>`);
  });

  it('does not touch UTF-16 documents', async () => {
    const utf16 = Buffer.from('\ufeff<html><head></head>', 'utf16le');
    expect(await injectAgentBuffer(utf16, 'a.html')).toEqual(utf16);
  });

  it('is byte-exact for non-UTF-8 content', async () => {
    const latin = Buffer.concat([
      Buffer.from('<head><title>'),
      Buffer.from([0xe9, 0xff, 0x80]),
      Buffer.from('</title>'),
    ]);
    const out = await injectAgentBuffer(latin, 'index.html');
    const expected = Buffer.concat([
      Buffer.from(`<head>${TAG}<title>`),
      Buffer.from([0xe9, 0xff, 0x80]),
      Buffer.from('</title>'),
    ]);
    expect(out).toEqual(expected);
  });

  it('handles empty, whitespace-only, comment-only and truncated documents without breaking them', async () => {
    expect(await inject('')).toBe(`<head>${TAG}</head>`);
    expect(await inject('  \n')).toBe(`  \n<head>${TAG}</head>`);
    expect(await inject('<!-- only -->')).toBe(`<!-- only --><head>${TAG}</head>`);
    // 未結束的註解：插入點必須在註解之前，不能落在註解裡面。
    expect(await inject('<!doctype html><!-- unterminated <head>')).toBe(
      `<!doctype html><head>${TAG}</head><!-- unterminated <head>`,
    );
    expect(await inject('<!doctype html><di')).toBe(`<!doctype html><head>${TAG}</head><di`);
  });

  it('handles malformed markup around the head', async () => {
    expect(await inject('<html><head><meta charset=utf-8<title>x')).toBe(
      `<html><head>${TAG}<meta charset=utf-8<title>x`,
    );
    // 孤立的結束標籤：瀏覽器會忽略它們，agent 仍然只出現一次、在所有真正的內容之前。
    const stray = await inject('</div></p><html><head><title>x</title>');
    expect(stray.split('data-hpe-page').length).toBe(2);
    expect(stray.indexOf(TAG)).toBeLessThan(stray.indexOf('<html>'));
  });

  it('works when chunks split the document at every possible offset', async () => {
    const doc =
      '\u00ef\u00bb\u00bf<!DOCTYPE html><!-- x --><HTML>\n<HEAD lang="a">\n<title>t</title></HEAD><body>é</body></HTML>';
    const bytes = Buffer.from(doc, 'latin1');
    const expected = await injectAgentBuffer(bytes, 'index.html');
    for (let i = 1; i < bytes.length; i++) {
      const inj = new AgentInjector('index.html');
      const parts: Buffer[] = [];
      inj.on('data', (b: Buffer) => parts.push(b));
      await new Promise<void>((resolve, reject) => {
        inj.on('end', resolve).on('error', reject);
        Readable.from([bytes.subarray(0, i), bytes.subarray(i)], { objectMode: false }).pipe(inj);
      });
      expect(Buffer.concat(parts).equals(expected)).toBe(true);
    }
  });

  it('passes the rest through untouched after the decision (large document)', async () => {
    const body = 'x'.repeat(3 * 1024 * 1024);
    const out = await inject(`<html><head></head><body>${body}</body></html>`);
    expect(out).toBe(`<html><head>${TAG}</head><body>${body}</body></html>`);
  });
});
