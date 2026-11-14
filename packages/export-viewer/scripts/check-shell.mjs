// 建置後檢查：dist/index.html 必須是可被 buildSingleFileHtml 填入的單檔 shell。
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const file = resolve(root, 'dist/index.html');
const html = readFileSync(file, 'utf8');
const errors = [];
const fail = (m) => errors.push(m);

const PLACEHOLDER = '<!--HPE_PAYLOAD-->';
const browserSrc = readFileSync(resolve(root, '../exporter/src/browser.ts'), 'utf8');
const csp = /EXPORT_SHELL_CSP =\s*"([^"]+)"/.exec(browserSrc)?.[1];
if (!csp) fail('cannot read EXPORT_SHELL_CSP from exporter/src/browser.ts');

// 1. placeholder 恰好一次，且位於 application/json 的 #hpe-data script 內
const count = html.split(PLACEHOLDER).length - 1;
if (count !== 1) fail(`placeholder must appear exactly once, found ${count}`);
const dataRe =
  /<script\b(?=[^>]*\btype="application\/json")(?=[^>]*\bid="hpe-data")[^>]*>\s*<!--HPE_PAYLOAD-->\s*<\/script>/g;
if ((html.match(dataRe) ?? []).length !== 1)
  fail('placeholder is not inside <script type="application/json" id="hpe-data">');

// 2. CSP meta 恰好一個，且與 EXPORT_SHELL_CSP 完全相同，並且是 <head> 的第一個子元素
const metas = html.match(/<meta\b[^>]*http-equiv="?Content-Security-Policy"?[^>]*>/gi) ?? [];
if (metas.length !== 1) fail(`expected exactly one CSP meta, found ${metas.length}`);
else if (csp && !metas[0].includes(`content="${csp}"`))
  fail('CSP meta differs from EXPORT_SHELL_CSP');
if (!/<head[^>]*>\s*<meta\b[^>]*http-equiv="?Content-Security-Policy/i.test(html))
  fail('CSP meta must be the first child of <head>');

// 3. 沒有任何外部資源參照
for (const m of html.matchAll(
  /<(script|link|img|iframe|source|video|audio)\b[^>]*\b(src|href)\s*=\s*"([^"]*)"/gi,
)) {
  if (!/^(data:|#)/i.test(m[3]))
    fail(`external reference: <${m[1]} ${m[2]}="${m[3].slice(0, 80)}">`);
}
if (/@import\s|url\(\s*["']?https?:/i.test(html)) fail('CSS @import or remote url() found');

// 4. script 標籤結構：依 HTML 的 script-data 規則逐段掃描（script 內容裡的 "<script" 字樣不算標籤）
let pos = 0;
let scripts = 0;
for (;;) {
  const open = html.slice(pos).search(/<script\b/i);
  if (open < 0) break;
  const from = pos + open;
  const close = html.slice(from).search(/<\/script/i);
  if (close < 0) {
    fail('unterminated <script>');
    break;
  }
  scripts++;
  pos = from + close + 9;
}
if (scripts !== 2) fail(`expected exactly 2 scripts (data + app), found ${scripts}`);
// 資料 script 之外不得再出現 `<!--`（避免 script-data double-escaped 狀態）
const withoutData = html.replace(dataRe, '');
if (withoutData.includes('<!--'))
  fail('found "<!--" outside the data block (would be unsafe inside inline script)');

if (errors.length) {
  console.error(`check-shell FAILED:\n - ${errors.join('\n - ')}`);
  process.exit(1);
}
const raw = statSync(file).size;
const gz = gzipSync(readFileSync(file), { level: 9 }).length;
console.log(`check-shell OK: dist/index.html ${raw} B raw, ${gz} B gzip`);
