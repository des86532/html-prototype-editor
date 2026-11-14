/** 規格「Impact／API」「Parent 端訊息處理規則」中的所有數值上限，集中在這裡避免魔術數字。 */

export const MB = 1024 * 1024;

export const UPLOAD_LIMITS = {
  /** 壓縮檔 ≤ 50 MB */
  maxArchiveBytes: 50 * MB,
  /** 解壓後 ≤ 200 MB */
  maxExtractedBytes: 200 * MB,
  /** 檔案數 ≤ 2,000 */
  maxEntries: 2000,
  /** 單檔壓縮比 ≤ 100:1 */
  maxCompressionRatio: 100,
  /** 貼上原始碼／單一 HTML 的上限（獨立於 zip） */
  maxSingleHtmlBytes: 20 * MB,
} as const;

/** 副檔名白名單（小寫、不含點）。 */
export const ALLOWED_EXTENSIONS = [
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'json',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'mp4',
  'webm',
  'mp3',
  'txt',
  'map',
] as const;

export const PAGE_EXTENSIONS = ['html', 'htm'] as const;

export const MESSAGE_LIMITS = {
  /** 序列化後超過 64 KB 直接丟棄 */
  maxBytes: 64 * 1024,
  /** 120 則/秒（token bucket） */
  maxPerSecond: 120,
  /** selector（css/xpath）≤ 1 KB */
  maxSelectorLength: 1024,
  /** textQuote（exact/prefix/suffix）≤ 512 字元 */
  maxTextQuoteLength: 512,
  maxSnapshotTextLength: 120,
  maxLabelLength: 200,
  maxRects: 2000,
  maxAnchorsPerRequest: 500,
  maxStorageBlobBytes: 32 * 1024,
  maxDialogTextLength: 500,
} as const;

export const COMMENT_LIMITS = {
  maxBodyLength: 5000,
  maxTagsPerThread: 5,
  maxGuestNameLength: 40,
} as const;

export const FRAME_TIMINGS = {
  /** 每 2 秒 ping 一次 */
  heartbeatIntervalMs: 2000,
  /** 連續 3 次沒回應就提示 */
  heartbeatMissLimit: 3,
  /** load 後 1.5 秒內沒收到 ready 就遮罩 */
  readyTimeoutMs: 1500,
  /** hover 預覽延遲 */
  hoverPreviewDelayMs: 300,
  /** dialog toast 節流 */
  dialogToastThrottleMs: 1000,
} as const;

export const PIN_SIZE_PX = 28;
export const POPOVER_WIDTH_PX = 320;

export const DEVICE_PRESETS = [
  { id: 'desktop-1440', label: 'Desktop 1440', width: 1440, height: 900 },
  { id: 'laptop-1280', label: 'Laptop 1280', width: 1280, height: 800 },
  { id: 'tablet-768', label: 'Tablet 768', width: 768, height: 1024 },
  { id: 'mobile-390', label: 'Mobile 390', width: 390, height: 844 },
  { id: 'mobile-375', label: 'Mobile 375', width: 375, height: 812 },
] as const;

/** 擁有者可勾選的預設 CDN 清單（Impact／M2 step 12）。 */
export const CDN_PRESETS = [
  {
    id: 'google-fonts',
    label: 'Google Fonts',
    origins: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
  },
  { id: 'jsdelivr', label: 'jsDelivr', origins: ['https://cdn.jsdelivr.net'] },
  { id: 'unpkg', label: 'unpkg', origins: ['https://unpkg.com'] },
  { id: 'cdnjs', label: 'cdnjs', origins: ['https://cdnjs.cloudflare.com'] },
  { id: 'tailwind-play', label: 'Tailwind Play CDN', origins: ['https://cdn.tailwindcss.com'] },
] as const;

/** 評論 pin 的 8 色盤（依作者 id hash 選色）。 */
export const PIN_PALETTE = [
  '#e5484d',
  '#f76b15',
  '#ffb224',
  '#30a46c',
  '#0091ff',
  '#5b5bd6',
  '#d6409f',
  '#12a594',
] as const;

export const PROTOCOL_VERSION = 1 as const;
export const AGENT_PATH = '/__hpe/agent.v1.js';
export const AGENT_MAX_GZIP_BYTES = 15 * 1024;
export const ANNOTATIONS_SCHEMA_URL = 'https://hpe.example/schemas/annotations.v1.json';
