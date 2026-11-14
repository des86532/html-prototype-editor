import { Transform, type TransformCallback } from 'node:stream';
import { Parser } from 'htmlparser2';
import { AGENT_PATH } from '@hpe/shared';

/**
 * 在 HTML 串流中注入 frame-agent：
 *   `<script src="/__hpe/agent.v1.js" data-hpe-page="…"></script>` 放在 `<head>` 的第一個位置；
 *   沒有 `<head>` 就補一個 `<head>…</head>`（放在第一個非 `<html>` 元素或第一段文字之前）。
 *
 * 實作原則：
 *  - 位元組不變：以 latin1 解碼（1 byte = 1 char），parser 的 index 就是位元組位移，
 *    輸出時以 latin1 寫回，除了插入的片段外與原檔逐位元組相同（任何字元編碼都安全）。
 *  - 只在「決定插入點」之前緩衝（通常是檔案開頭的幾百 bytes），決定後其餘 chunk 直接穿透。
 *  - 保留 UTF-8 BOM（插在 BOM 後面）；UTF-16 BOM 的文件無法安全以 ASCII 片段插入，原樣輸出（不注入）。
 */

export function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function agentTag(pageId: string): string {
  return `<script src="${AGENT_PATH}" data-hpe-page="${escapeAttr(pageId)}"></script>`;
}

const UTF8_BOM = '\u00ef\u00bb\u00bf'; // EF BB BF 以 latin1 解讀
const UTF16_BOMS = ['\u00ff\u00fe', '\u00fe\u00ff'];

interface Decision {
  /** parser 座標（BOM 之後） */
  at: number;
  /** true = 需要補 `<head>…</head>`；false = 插在既有 `<head …>` 之後 */
  createHead: boolean;
}

export class AgentInjector extends Transform {
  private buf = '';
  private done = false;
  private started = false;
  private bomLen = 0;
  private fed = 0;
  private decision: Decision | null = null;
  private lastEnd = 0;
  private readonly parser: Parser;
  private readonly tag: string;

  constructor(pageId: string) {
    super();
    this.tag = agentTag(pageId);
    this.parser = new Parser({
      onopentag: (name) => {
        if (this.decision || name === 'html') return this.bump();
        this.decision =
          name === 'head'
            ? { at: this.parser.endIndex + 1, createHead: false }
            : { at: this.parser.startIndex, createHead: true };
      },
      ontext: (text) => {
        if (this.decision) return;
        if (text.trim() === '') return this.bump();
        this.decision = { at: this.parser.startIndex, createHead: true };
      },
      // 未結束的註解／處理指令（EOF 時由 parser 補發）不能算作「已消耗」，否則插入點會落在註解裡面。
      oncomment: () => this.bump(true),
      onprocessinginstruction: () => this.bump(true),
      onclosetag: () => this.bump(),
    });
  }

  private bump(checkTerminated = false): void {
    const end = this.parser.endIndex + 1;
    if (checkTerminated && this.buf[this.bomLen + end - 1] !== '>') {
      this.lastEnd = Math.max(this.lastEnd, this.parser.startIndex);
      return;
    }
    this.lastEnd = Math.max(this.lastEnd, end);
  }

  private feed(data: string): void {
    this.fed += data.length;
    this.parser.write(data);
  }

  private emitDecision(): void {
    const d = this.decision ?? { at: this.lastEnd, createHead: true };
    const at = this.bomLen + Math.min(d.at, this.fed);
    const insert = d.createHead ? `<head>${this.tag}</head>` : this.tag;
    this.push(Buffer.from(this.buf.slice(0, at) + insert + this.buf.slice(at), 'latin1'));
    this.buf = '';
    this.done = true;
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    if (this.done) return cb(null, chunk);
    this.buf += chunk.toString('latin1');
    if (!this.started) {
      // 需要至少 3 bytes 才能判斷 BOM。
      if (
        this.buf.length < 3 &&
        (UTF8_BOM.startsWith(this.buf) || UTF16_BOMS.some((b) => b.startsWith(this.buf)))
      )
        return cb();
      this.started = true;
      if (UTF16_BOMS.some((b) => this.buf.startsWith(b))) {
        this.push(Buffer.from(this.buf, 'latin1'));
        this.buf = '';
        this.done = true;
        return cb();
      }
      if (this.buf.startsWith(UTF8_BOM)) this.bomLen = 3;
      this.feed(this.buf.slice(this.bomLen));
    } else {
      this.feed(chunk.toString('latin1'));
    }
    if (this.decision) this.emitDecision();
    cb();
  }

  override _flush(cb: TransformCallback): void {
    if (!this.done) {
      if (!this.started) {
        this.started = true;
        if (UTF16_BOMS.some((b) => this.buf.startsWith(b))) {
          this.push(Buffer.from(this.buf, 'latin1'));
          return cb();
        }
        if (this.buf.startsWith(UTF8_BOM)) this.bomLen = 3;
        this.feed(this.buf.slice(this.bomLen));
      }
      this.parser.end();
      this.emitDecision();
    }
    cb();
  }
}

/** 一次處理完整文件（測試與小檔案用）。 */
export async function injectAgentBuffer(html: Buffer | string, pageId: string): Promise<Buffer> {
  const inj = new AgentInjector(pageId);
  const out: Buffer[] = [];
  inj.on('data', (b: Buffer) => out.push(b));
  const done = new Promise<void>((resolve, reject) => {
    inj.on('end', resolve);
    inj.on('error', reject);
  });
  inj.end(typeof html === 'string' ? Buffer.from(html, 'utf8') : html);
  await done;
  return Buffer.concat(out);
}
