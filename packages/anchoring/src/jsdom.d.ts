// jsdom 沒有自帶型別；測試只用到 `new JSDOM(html).window.document`。
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    window: Window & typeof globalThis;
  }
}
