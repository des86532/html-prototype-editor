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
  maxStorageBlobBytes: 32 * 1024,
  maxDialogTextLength: 500,
} as const;

export const COMMENT_LIMITS = {
  maxBodyLength: 5000,
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

/** 作者的 8 色盤（依作者 id hash 選色）：標記編號 badge、線上頭像、游標。 */
export const AUTHOR_PALETTE = [
  '#e5484d',
  '#f76b15',
  '#ffb224',
  '#30a46c',
  '#0091ff',
  '#5b5bd6',
  '#d6409f',
  '#12a594',
] as const;

/** 標記顏色（紅、橙、黃、綠、藍、黑）。只允許這幾個值：直接寫進 SVG 屬性，不接受任意字串。 */
export const MARKUP_COLORS = [
  '#e5484d',
  '#f76b15',
  '#ffb224',
  '#30a46c',
  '#0091ff',
  '#24211c',
] as const;
/** 線條粗細（細、中、粗）；文字工具用它對應字級（見 markup.ts 的 textFontSize）。 */
export const MARKUP_STROKES = [2, 4, 8] as const;
export const MARKUP_LIMITS = {
  maxPoints: 2000,
  maxTextLength: 200,
  /** 頁面座標絕對值上限（CSS px） */
  maxCoordinate: 100_000,
  minViewport: 200,
  maxViewport: 4000,
} as const;

export const PROTOCOL_VERSION = 1 as const;
export const AGENT_PATH = '/__hpe/agent.v1.js';
export const AGENT_MAX_GZIP_BYTES = 15 * 1024;
export const ANNOTATIONS_SCHEMA_URL = 'https://hpe.example/schemas/annotations.v2.json';
