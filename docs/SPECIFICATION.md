# html-prototype-editor 規格書與實作計畫（Issue #1）

本文件為 Issue #1 的規格書與實作計畫，只描述設計，尚無對應實作程式碼。各章節以 Problem / Proposed Solution / Impact / Steps / Verification / Risks 組織。

## Problem

### 現況與目標
使用者常用 HTML 做 prototype 給利害關係人討論，但現在的回饋散在聊天、Email 和截圖裡，很難對到「哪個畫面、哪個元素、在哪個裝置寬度」。Issue #1 要的是一個網站，具體需求如下：
1. 能匯入 HTML prototype，讓審閱者瀏覽畫面。
2. 審閱者可以直接在畫面上留 comment，回饋能精準定位。
3. 匯出時要包含所有 comment。
4. 匯入的 HTML 可能含有惡意程式碼，必須防範。
5. 請求「完善功能、提出建議」。

### 核心技術挑戰
| 挑戰 | 說明 |
|---|---|
| **跑不受信任的程式碼** | prototype 需要 JS 才能互動（tabs、modal、Alpine/Vue CDN），所以不能只把 script 刪掉，必須在隔離環境裡讓它安全執行。 |
| **跨 frame 錨定** | 沙箱 iframe 和主應用不同 origin，主應用讀不到 iframe 的 DOM。必須把一支 agent 注入 frame，再用 `postMessage` 溝通，而 agent 和惡意 prototype 處在同一個信任域裡。 |
| **RWD 錨點漂移** | 只存視窗座標的百分比，換個寬度或換個版本 pin 就會錯位，需要以 DOM 為主、座標為輔的混合錨點。 |
| **隔離後相容性變差** | opaque origin 下 `localStorage` 和 `document.cookie` 會丟 `SecurityError`，外部 CDN 也會被 CSP 擋掉，需要 polyfill 和白名單機制。 |
| **匯出要自包含又要安全** | 單一 HTML 匯出要能離線開、保留沙箱，而且 comment 文字匯出時不能變成 stored XSS 的載體。 |

### 明確假設（沒有額外指示前的預設）
- **A1** 形態是 SaaS 或可自架的 Web 應用。擁有者需要帳號；審閱者可以透過分享連結以訪客身分（填名字）留言。
- **A2** prototype 的形式：單一 `.html`、`.zip`（含 `index.html` 和資源、可多頁），或直接貼上原始碼。不做「輸入 URL 匯入」，因為有 SSRF 風險，列為後續功能。
- **A3** 介面以繁體中文為主，從一開始就預留 i18n。
- **A4** 支援最近兩版的 Chromium、Firefox 和 Safari 桌面瀏覽器，行動裝置只要求能閱覽。
- **A5** 單一組織使用，不在 MVP 做多租戶計費。

---

## Proposed Solution

### 1. 整體架構（三個 origin 隔離）

```
┌──────────────────────────── app.example.com（受信任）────────────────────────────┐
│  React SPA：專案管理 / Viewer / Comment Sidebar / Pin Overlay / Export            │
│  CSP: script-src 'self'; frame-src https://*.protousercontent.net; frame-ancestors 'none' │
│                                                                                  │
│   ┌───────── <iframe sandbox="allow-scripts" allow="" referrerpolicy="no-referrer"> ─────────┐
│   │ https://{contentKey}.protousercontent.net/index.html   ← 不同的可註冊網域   │
│   │  CSP header：sandbox allow-scripts; connect-src 'self'; form-action 'none' ... │
│   │  ┌ frame-agent（伺服器注入在 <head> 第一個 script）──────────────┐            │
│   │  │ picker / geometry / anchoring / storage polyfill / nav guard │            │
│   │  └──────────── postMessage（不受信任通道，只傳幾何與 selector）───┘            │
│   └────────────────────────────────────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────────────────────┘
          │ REST (cookie session)                         ▲ 靜態檔 + header + agent 注入
          ▼                                               │
   api.example.com (Fastify) ── Postgres ── S3/MinIO ── content server (protousercontent.net)
                                    └── render-worker (Playwright, Phase 3, egress 封鎖)
```

**關鍵決策：**

| # | 決策 | 理由 | 考慮過的替代方案 |
|---|---|---|---|
| D1 | prototype 一律從**獨立的可註冊網域**（`protousercontent.net`，不能是 `app.example.com` 的子網域）提供，每個版本用一個子網域 `{contentKey}`（128-bit 隨機值，base32） | 跨 site 才會被分到獨立 process（site isolation），prototype 跑無窮迴圈也不會拖垮主應用；cookie 和 `document.domain` 也無法橫向影響。子網域本身就是 capability URL，root-relative 路徑（`/assets/x.css`）照樣能用；撤銷存取只要換掉 contentKey。 | 用 `srcdoc` 或 `blob:` 載入：這些 local scheme 文件會**繼承父頁面的 CSP**，要嘛 prototype 的 inline script 被擋，要嘛主應用得放寬 CSP，兩者都不能接受。 |
| D2 | iframe 加 `sandbox="allow-scripts"`，**不加** `allow-same-origin`、`allow-top-navigation*`、`allow-popups`、`allow-forms`、`allow-modals`、`allow-downloads` | prototype 拿到 opaque origin，讀不到任何 storage、cookie 或主應用 DOM，也無法開新視窗或轉址 top。 | 加 `allow-same-origin`：配合 `allow-scripts` 等於沙箱失效，禁止。 |
| D3 | content server 回應帶 **CSP `sandbox allow-scripts` header** | 就算有人直接用網址開 content URL（沒有 iframe 的 sandbox 屬性），沙箱照樣生效。這是縱深防禦。 | 只靠 iframe 屬性：直接開網址時會失守。 |
| D4 | 預設**離線嚴格模式**：`connect-src 'self'`，`img-src`/`font-src` 只允許 `'self' data: blob:`；外部 CDN 由擁有者從預設清單中逐一勾選開放 | 擋住 beacon、fetch、CSS `url()` 這類資料外送；匯入時的分析器會列出被擋掉的外部資源，讓擁有者決定。 | 全開：等於讓 prototype 追蹤審閱者的 IP 和行為。 |
| D5 | **postMessage 通道一律視為不受信任**：frame 傳來的訊息全部過 zod schema、大小上限和頻率上限；**comment 內文、使用者身分、token 永遠不送進 frame** | agent 和 prototype script 在同一個 JS realm，prototype 能攔截 MessagePort、也能偽造訊息，所以 agent 本身無法被驗證。安全邊界只能放在 parent。 | 用 MessageChannel 加 nonce「認證」agent：做不到真正的認證，只會給人錯誤的安全感。 |
| D6 | **Pin 畫在 parent 的 overlay**，agent 只回報幾何資訊（rect） | comment UI 和內容都留在受信任的 context，prototype 的 CSS/JS 刪不掉、改不了、讀不到 pin。 | 在 frame 內用 closed shadow DOM 畫 pin：捲動自然同步，但 prototype 能刪掉它，comment 內容也會暴露。 |
| D7 | **混合錨點**：多組 selector 加上元素內相對偏移，再加文件座標做 fallback，並附信心分數 | 跨 RWD 寬度、跨版本都要能活下來；資料模型對齊 W3C Web Annotation（`CssSelector`、`XPathSelector`、`TextQuoteSelector`），匯出 JSON 可以和其他工具互通。 | 只存百分比座標：一縮放就錯位。只存 CSS path：DOM 一改就斷。 |
| D8 | 前端用 **Vite + React 19 + TypeScript (strict) + Tailwind CSS v4 + Zustand + TanStack Query/Router** | 截圖、Playwright、Markdown/sanitize 的生態完整；單檔匯出 viewer 可以用 `vite-plugin-singlefile` 從同一份 code 建置。 | Vue 3 也可行，換掉不影響架構；選 React 只是因為生態和匯出 viewer 共用元件比較方便。 |
| D9 | 後端用 **Node 22 + Fastify + Drizzle ORM + PostgreSQL + S3 相容儲存（開發用 MinIO 或本機 FS adapter）**，以 pnpm monorepo 管理 | 型別（`packages/shared`）前後端共用；content server 是獨立 process，綁獨立網域。 | 純前端 local-first（IndexedDB）：做不到「傳連結給使用者留言」這個核心流程，最多當作匯出 viewer 的唯讀模式。 |

### 2. 沙箱安全規格

**iframe 屬性**
```html
<iframe src="https://{contentKey}.protousercontent.net/{pagePath}"
        sandbox="allow-scripts"
        allow=""                          <!-- Permissions Policy 全部拒絕 -->
        referrerpolicy="no-referrer"
        loading="eager" title="Prototype 預覽（不受信任內容）"></iframe>
```

**content server 回應 header（HTML）**
```
Content-Security-Policy: sandbox allow-scripts; default-src 'none';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' {allowlisted-cdns};
  style-src 'self' 'unsafe-inline' {allowlisted-cdns}; img-src 'self' data: blob:;
  font-src 'self' data: {allowlisted-cdns}; media-src 'self' data: blob:;
  connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none';
  base-uri 'self'; form-action 'none'; frame-ancestors https://app.example.com;
  report-to csp-endpoint
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), display-capture=()
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Cross-Origin-Resource-Policy: same-site
Cache-Control: private, max-age=300
```
- `'unsafe-inline'` 和 `'unsafe-eval'` 是刻意開的：prototype 常有 inline script，也常用 Alpine 或 Vue 的瀏覽器端 compiler。這裡真正的安全邊界是 opaque origin 加跨 site 隔離，CSP 只負責擋網路外送和 `<base>`、`<object>`、表單。
- `connect-src 'self'` 讓 prototype 能 fetch 同一個 bundle 裡的 mock JSON。content server 對 bundle 內的資源回 `Access-Control-Allow-Origin: *`。這不會多洩漏什麼，因為知道 contentKey 的人本來就能直接 GET。
- 非 HTML 資源的 Content-Type 由伺服器依副檔名決定，不採用上傳時宣稱的 MIME。SVG 同樣受 CSP sandbox header 保護。

**主應用 CSP**
```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:;
frame-src https://*.protousercontent.net; connect-src 'self' https://api.example.com;
object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self';
require-trusted-types-for 'script'
```

**frame-agent 的相容與防護層**（agent 不是安全邊界，只負責相容性和偵測）

| 功能 | 行為 |
|---|---|
| Storage polyfill | 用 in-memory 實作取代 `localStorage`、`sessionStorage` 和 `document.cookie`，避免 opaque origin 下丟錯讓 prototype 壞掉。多頁之間要不要延續狀態，由 parent 暫存一個 frame 提供的 opaque blob（不解析、不渲染）。 |
| Dialog polyfill | `alert`、`confirm`、`prompt` 改成送訊息給 parent，parent 以純文字 toast 顯示（`confirm` 固定回 `true`，`prompt` 回 `null`）。 |
| 導覽守衛 | 攔截指向外部的 `<a>` 點擊並阻止。parent 監聽 iframe 的 `load`：如果 1.5 秒內沒收到 agent 的 `ready`（代表 frame 被 `location=` 或 `meta refresh` 導到外部頁面），立刻用遮罩蓋住 frame，顯示「prototype 已離開預覽範圍」並提供重新載入。 |
| 心跳 | 每 2 秒 ping 一次，連續 3 次沒回應就提示「prototype 無回應（可能有無窮迴圈）」並提供「停止 prototype」（移除 iframe）。 |
| 表單 | 沒有 `allow-forms`，submit 本來就會被擋；agent 在 submit 時送提示給 parent，顯示「預覽模式不送出表單」。 |

**Parent 端訊息處理規則**
1. 只接受 `event.source === iframe.contentWindow` 的訊息（opaque origin 的 `event.origin` 會是 `"null"`，不能拿 origin 來判斷）。
2. 先擋大小：序列化後超過 64 KB 直接丟棄；再用 zod 的 `FrameToParentSchema.safeParse` 驗證，失敗就丟棄並記錄。
3. 頻率上限 120 則/秒（token bucket），超過就暫停處理並顯示警告。
4. frame 只能觸發「建立錨點草稿」和「更新幾何」，不能觸發任何會寫入資料的動作；寫入一律要使用者在 parent UI 明確送出。
5. selector 和文字片段這類 frame 給的字串，一律以純文字渲染，長度截斷（selector ≤ 1 KB，textQuote ≤ 512 字元）。

### 3. 評論錨定系統

**建立錨點（agent 端 `describe(element, point)`）**，依穩定度由高到低收集：
1. `dataAttr`：`data-comment-anchor` > `data-testid` > 看起來不像自動生成的穩定 `id`。文件會建議設計師替重點元素加上 `data-comment-anchor`。
2. `css`：最短的唯一 CSS path，優先用 id 和 class，避開疑似 hash 的 class（例如 `css-1x2y3z`）。
3. `xpath`：完整位置路徑。
4. `textQuote`：元素可見文字的 `exact`（≤ 256）加上前後各 32 字元的 `prefix`/`suffix`。
5. `fingerprint`：tag、class 集合、textHash、子節點索引、深度。
6. `elementOffset`：點擊位置在元素 bbox 內的相對位置（0–1）。區域評論另外存相對寬高。
7. `fallback`：建立當下的文件座標（CSS px），加上建立時的 viewport 寬高和 DPR。
8. `stateHint`：`location.hash`、當下開啟的 `<dialog>` 或 `[aria-modal]` 祖先，用來提示「這則評論在某個狀態下才看得到」。

**解析錨點（`resolve(anchor)`）** 會依序嘗試，每一步都比對 fingerprint 打分：
`dataAttr → css → xpath → textQuote（模糊比對，diff-match-patch）→ fingerprint 全文件掃描 → fallback 座標`

| 結果狀態 | 條件 | UI 呈現 |
|---|---|---|
| `exact` | 前三種 selector 命中，且 fingerprint ≥ 0.9 | 一般 pin |
| `fuzzy` | 靠文字或 fingerprint 命中，0.6 ≤ 信心 < 0.9 | pin 加虛線框，標示「位置可能有變」 |
| `hidden` | 找到元素，但 `display:none`、bbox 為 0 或在關閉的 modal 裡 | 不畫 pin；sidebar 標示「目前狀態不可見」，附 stateHint |
| `fallback` | 元素找不到，退回座標 | 灰色 pin 加警告 |
| `orphaned` | 頁面不存在或座標超出文件 | 只出現在 sidebar 的「孤兒評論」 |

**RWD 與幾何同步**
- 裝置預設：Desktop 1440、Laptop 1280、Tablet 768、Mobile 390、Mobile 375，也可自訂。iframe 用實際寬度渲染，外層用 `transform: scale()` 縮放到符合畫面，overlay 套同一個 scale。
- agent 用 `ResizeObserver`、`MutationObserver`、`scroll`（capture，同時涵蓋內部捲動容器）和 `requestAnimationFrame` 節流，送出 `geometry`：frame viewport 座標系下的 `rects: Record<threadId, Rect | null>`。parent 依 rect 和 scale 定位 pin；不在可視區的 pin 改在邊緣顯示指示箭頭。
- 每則評論記錄建立時的 breakpoint，sidebar 可以篩選「只看目前寬度」或「全部」。

**互動模式**
- 預設是 **Interact 模式**，可以正常操作 prototype。
- 按 `C` 進入 **Comment 模式**：agent 在 window 上以 capture phase 攔截 `pointerdown`、`click`、`mouseover` 並 `preventDefault`，同時回報 hover rect，由 parent 畫出高亮框。
  - 單擊是元素 pin。
  - 拖曳是區域評論，錨定在包住整個區域的最近共同祖先。
  - 選取文字後點「評論」，以 `textQuote` 為主錨點。
  - 按住 `Alt` 可以暫時回到互動。
- 快捷鍵：`C` 切換、`Esc` 取消、`J`/`K` 上一則或下一則、`R` 標記解決。pin 是 parent 裡的 `<button aria-label="評論 #12：…">`，sidebar 完整支援鍵盤操作。

### 4. 功能完善建議（優先級）

| 優先級 | 功能 |
|---|---|
| **P0（MVP）** | 匯入 html/zip/貼上；匯入安全報告（列出 script、外部資源、表單、密碼欄位、`meta refresh`、iframe）；Viewer、裝置預設、多頁導覽；三種評論（元素、區域、文字）；討論串、回覆、Open/Resolved 狀態；分類標籤（Bug／文案／設計／問題／建議）；篩選（狀態、頁面、寬度、作者、標籤）；分享連結（viewer/commenter 角色、到期、撤銷）；訪客留名；匯出 JSON、Markdown、CSV、單檔互動 HTML、Review Package ZIP |
| **P1** | 版本管理（上傳新版本並自動遷移未解決評論，附 drift 狀態）；版本並排比較；@mention 與 Email 通知；優先級欄位；未讀標記；擁有者白名單 CDN；匯出 PNG/PDF（render worker）；評論附截圖裁切 |
| **P2** | 即時協作（SSE/WebSocket 推送新評論、presence 游標）；推送到 GitHub Issues、Jira、Linear；Slack webhook；AI 彙整回饋摘要和去重；匯入時把白名單 CDN 資源 vendor 化；URL 匯入（伺服器抓取並防 SSRF）；互動路徑錄製（重播到 hidden 狀態）；瀏覽器擴充功能 |

### 5. 匯出規格

| 格式 | 內容 | 安全處理 |
|---|---|---|
| **單檔互動 HTML**（`review-{slug}-v{n}-{date}.html`） | 用 `vite-plugin-singlefile` 建置的 export-viewer shell（sidebar、pin、裝置切換、篩選，唯讀），所有頁面 HTML、inline 化的資源和 annotations JSON 都包在一個檔案裡。prototype 以 `<iframe sandbox="allow-scripts" srcdoc>` 載入，agent 也 inline。多頁導覽由 agent 攔截點擊，請 shell 換掉 `srcdoc`。 | shell 的 meta CSP 是 `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'`。srcdoc 會繼承這份 CSP，所以匯出檔**完全無法連網**。comment JSON 放在 `<script type="application/json">`，並跳脫 `<`、`>`、`&`、`U+2028`、`U+2029` 為 `\uXXXX`；shell 一律用 `textContent` 渲染。檔案超過 20 MB 時提醒。 |
| **JSON**（`annotations.json`） | 帶 `$schema` 版本號；`items[]` 相容 W3C Web Annotation（`target.selector[]`、`body[]`），並延伸 `x-hpe:` 欄位（狀態、標籤、breakpoint、編號） | JSON.stringify，不需額外處理 |
| **Markdown** | 依頁面分組，編號和 pin 一致；每則包含作者、時間、狀態、標籤、元素描述（tag 加文字片段加 selector）、breakpoint、回覆串 | 跳脫 Markdown 控制字元；內文包在引用區塊；不輸出原始 HTML |
| **CSV** | 一列一則討論串，可以匯入 Jira 或試算表 | 防公式注入：開頭是 `=`、`+`、`-`、`@`、Tab 或 CR 的儲存格前面加 `'`；RFC 4180 引號 |
| **Review Package ZIP** | `manifest.json`、原始 bundle 和 `annotations.json`，可以再匯入（備份或搬家） | 再匯入時走同一套 zip 驗證流程 |
| **PNG / PDF**（P1） | render-worker 用 Playwright 在指定 viewport 截全頁圖，把編號 pin 畫進圖裡，最後附評論表 | 見 Impact 中的 render-worker 隔離 |

### 6. 模組劃分與檔案結構

```
html-prototype-editor/
├─ package.json / pnpm-workspace.yaml / tsconfig.base.json / turbo.json
├─ .github/workflows/ci.yml            # lint, typecheck, vitest, playwright（含 security suite）
├─ docker-compose.yml                  # postgres, minio
├─ apps/
│  ├─ web/                             # 主應用（app origin）
│  │  └─ src/
│  │     ├─ routes/                    # TanStack Router：/projects, /p/:id/v/:ver, /s/:shareToken
│  │     ├─ features/
│  │     │  ├─ projects/               # ProjectList, ProjectSettings
│  │     │  ├─ import/                 # ImportDialog, SecurityReportPanel, CdnAllowlistPicker
│  │     │  ├─ viewer/                 # PrototypeViewer, SandboxFrame, DeviceToolbar, PinOverlay,
│  │     │  │                          # HoverHighlight, FrameWatchdog, useFrameBridge
│  │     │  ├─ comments/               # CommentSidebar, ThreadView, Composer, Filters, useThreads
│  │     │  ├─ share/                  # ShareDialog, GuestIdentityPrompt
│  │     │  └─ export/                 # ExportDialog
│  │     └─ lib/                       # apiClient, sanitize.ts(DOMPurify+TrustedTypes), markdown.ts(markdown-it html:false)
│  ├─ api/                             # Fastify（api origin）
│  │  └─ src/
│  │     ├─ routes/                    # projects, versions, threads, comments, share, exports, csp-report
│  │     ├─ import/                    # extractZip.ts, validateEntries.ts, analyze.ts, entryDetect.ts
│  │     ├─ storage/                   # StorageAdapter (fs | s3)
│  │     ├─ db/                        # drizzle schema + migrations
│  │     ├─ auth/                      # session, shareToken (hash), roles guard
│  │     └─ security/                  # rateLimit, contentKey rotate
│  ├─ content/                         # content origin server（*.protousercontent.net）
│  │  └─ src/                          # server.ts, resolveVersion.ts, headers.ts, injectAgent.ts(htmlparser2 streaming)
│  └─ render-worker/                   # P1：Playwright 截圖/PDF（隔離容器）
├─ packages/
│  ├─ shared/                          # types.ts, schemas.ts(zod), protocol.ts, limits.ts, errors.ts
│  ├─ anchoring/                       # describe.ts, resolve.ts, cssPath.ts, xpath.ts, textQuote.ts, fingerprint.ts
│  ├─ frame-agent/                     # bridge.ts, picker.ts, geometry.ts, navGuard.ts, polyfills.ts → IIFE ≤ 15KB gz
│  ├─ exporter/                        # json.ts, markdown.ts, csv.ts, singleFileHtml.ts, inlineAssets.ts, package.ts
│  └─ export-viewer/                   # 單檔匯出 shell（React 精簡版，共用 PinOverlay/ThreadView）
└─ tests/
   ├─ security/vectors/*.html          # 惡意測試向量
   ├─ security/sandbox.spec.ts         # Playwright × chromium/firefox/webkit
   ├─ fixtures/anchoring/{v1,v2}/      # DOM 變動配對樣本
   └─ e2e/                             # 匯入→評論→分享→匯出 流程
```

### 7. 核心 TypeScript 介面（`packages/shared`）

```ts
// ---------- 領域模型 ----------
export type Id = string; // ULID
export type Role = 'owner' | 'commenter' | 'viewer';
export type ThreadStatus = 'open' | 'resolved';
export type ThreadTag = 'bug' | 'copy' | 'design' | 'question' | 'suggestion';

export interface Project { id: Id; name: string; ownerId: Id; createdAt: string; }

export interface PrototypeVersion {
  id: Id; projectId: Id; number: number;           // v1, v2...
  contentKey: string;                               // 子網域 capability，可輪替
  entryPage: string;                                // e.g. "index.html"
  pages: PageInfo[];
  cdnAllowlist: string[];                           // 擁有者核准的 origin
  analysis: SecurityReport;
  status: 'processing' | 'ready' | 'rejected';
  createdAt: string;
}
export interface PageInfo { path: string; title: string | null; }
export interface AssetRecord { versionId: Id; path: string; sha256: string; size: number; mime: string; }

export interface SecurityReport {
  scripts: { inline: number; external: string[] };
  externalResources: { url: string; kind: 'script' | 'style' | 'img' | 'font' | 'media' | 'other'; blocked: boolean }[];
  forms: number; passwordInputs: number; iframes: string[];
  metaRefresh: boolean; baseTag: boolean; serviceWorkerRegistration: boolean;
  warnings: string[];                               // 給人看的摘要（不是安全邊界）
}

export interface Thread {
  id: Id; versionId: Id; number: number;            // 專案內穩定編號 #12
  anchor: Anchor; status: ThreadStatus; tags: ThreadTag[];
  createdBy: Author; createdAt: string; resolvedAt?: string;
  comments: Comment[];
  carriedFrom?: { threadId: Id; versionId: Id; resolution: AnchorStatus };
}
export interface Comment { id: Id; threadId: Id; author: Author; body: string /* ≤5000, plain/markdown-lite */; createdAt: string; editedAt?: string; }
export type Author = { kind: 'user'; userId: Id; name: string } | { kind: 'guest'; guestId: Id; name: string };

export interface ShareLink { id: Id; projectId: Id; role: Exclude<Role, 'owner'>; tokenHash: string; expiresAt?: string; revokedAt?: string; }

// ---------- 錨點 ----------
export interface Rect { x: number; y: number; w: number; h: number; }
export interface Anchor {
  pageId: string;                                   // bundle 內路徑
  kind: 'element' | 'region' | 'text';
  viewport: { width: number; height: number; dpr: number; preset?: string };
  selectors: {
    dataAttr?: { name: string; value: string };
    css?: string; xpath?: string;
    textQuote?: { exact: string; prefix: string; suffix: string };
    fingerprint: { tag: string; classes: string[]; textHash: string; siblingIndex: number; depth: number };
    elementOffset: { x: number; y: number };        // 0..1
    regionSize?: { w: number; h: number };          // 相對元素 bbox
  };
  fallback: Rect;                                   // 文件座標 CSS px
  stateHint?: { hash?: string; inDialog?: boolean };
  snapshot: { tag: string; text: string /* ≤120 */ };
}
export type AnchorStatus = 'exact' | 'fuzzy' | 'hidden' | 'fallback' | 'orphaned';
export interface ResolvedAnchor { threadId: Id; status: AnchorStatus; confidence: number; rect: Rect | null; }

// ---------- postMessage 協定（v1，zod 驗證） ----------
export type ParentToFrame =
  | { v: 1; type: 'init'; mode: Mode; storageSeed?: string }
  | { v: 1; type: 'setMode'; mode: Mode }
  | { v: 1; type: 'resolveAnchors'; requestId: string; anchors: { threadId: Id; anchor: Anchor }[] }
  | { v: 1; type: 'trackAnchors'; threadIds: Id[] }
  | { v: 1; type: 'scrollToAnchor'; threadId: Id }
  | { v: 1; type: 'ping'; seq: number };
export type Mode = 'interact' | 'comment';

export type FrameToParent =
  | { v: 1; type: 'ready'; agentVersion: string; pageId: string; hash: string; docSize: { w: number; h: number } }
  | { v: 1; type: 'hover'; rect: Rect | null; label: string }
  | { v: 1; type: 'pick'; draft: Anchor; rect: Rect }
  | { v: 1; type: 'anchorsResolved'; requestId: string; results: ResolvedAnchor[] }
  | { v: 1; type: 'geometry'; viewport: { w: number; h: number }; rects: Record<Id, Rect | null> }
  | { v: 1; type: 'navigateRequest'; pageId: string }        // 匯出模式：請 shell 換 srcdoc
  | { v: 1; type: 'dialog'; kind: 'alert' | 'confirm' | 'prompt'; text: string }
  | { v: 1; type: 'storageSnapshot'; data: string }          // opaque，不解析
  | { v: 1; type: 'pong'; seq: number };
// 注意：ParentToFrame 永遠不含 comment body / author / token
```

---

## Impact

| 元件 | 影響與注意事項 |
|---|---|
| 主應用 `apps/web` | 所有使用者產生的內容（comment、名稱、frame 給的 selector）都只能用 `textContent` 或 sanitize 過的 markdown（`markdown-it` 設 `html:false`、加 DOMPurify、啟用 Trusted Types）渲染。從頭到尾不使用 `dangerouslySetInnerHTML` 處理未清洗的內容，用 lint rule 強制。 |
| API `apps/api` | 上傳限制：壓縮檔 ≤ 50 MB、解壓後 ≤ 200 MB、檔案數 ≤ 2,000、單檔壓縮比 ≤ 100:1；拒絕絕對路徑、`..`、symlink、反斜線、NUL 字元，並做 NFC 正規化；副檔名白名單（html、htm、css、js、mjs、json、svg、png、jpg、jpeg、gif、webp、avif、ico、woff、woff2、ttf、otf、mp4、webm、mp3、txt、map）。資源以 sha256 內容定址儲存。comment 和 guest 寫入有頻率限制（IP 加 shareToken）。 |
| content server `apps/content` | 依 `Host` 的 contentKey 找到版本，從 storage 串流輸出。HTML 回應用 htmlparser2 串流改寫，在 `<head>` 第一個位置注入 `<script src="/__hpe/agent.v1.js">`（沒有 `<head>` 就補一個）。換 contentKey 立即生效。 |
| DNS / TLS / 部署 | 需要第二個可註冊網域、wildcard DNS 和 wildcard 憑證，並確認網域**不在**主網域之下。開發環境用 `{key}.content.localhost:5174`（Chrome 和 Firefox 會把 `*.localhost` 解析到本機），主應用在 `localhost:5173`。 |
| 資料庫 | 資料表：`users`、`projects`、`prototype_versions`、`assets`、`threads`（`anchor` 存 jsonb）、`comments`、`share_links`（token 只存 hash）、`export_jobs`、`audit_log`；每個專案有一個 `thread_number_seq`。 |
| render-worker（P1） | 等於在伺服器上執行不受信任的 HTML，風險最高：需要獨立容器、**完全封鎖 egress**（防 SSRF，例如 `169.254.169.254`）、開啟 Chromium 自身的 sandbox、非 root、seccomp、每個工作限 30 秒和 1 GB；以 Review Package 方式把資料餵進去，不從內網抓。 |
| 相容性（對 prototype 作者） | opaque origin 帶來的限制：`localStorage` 和 cookie 改走 polyfill（只存在記憶體）、`fetch` 只能打 bundle 內的資源、外部 CDN 預設被擋、表單不會送出、`alert` 改成 toast、`window.open` 無效。匯入安全報告和文件要明確列出這些。 |
| 匯出檔 | 單檔 HTML 的大小受 base64 膨脹影響（約 1.33 倍）。匯出模式下，用 JS 改 `location` 跨頁無效，只支援點擊連結導覽。 |
| 營運 | 平台可能被拿來託管釣魚或惡意頁面，需要檢舉入口、下架流程，以及可選的 ClamAV 掃描；CSP violation 報告收進 `/csp-report` 做監控。 |

---

## Steps

> 原則：**M1 安全核心沒通過 security suite，不開始功能開發。** M0–M6 是 MVP。

**M0 專案骨架**
1. 建立 pnpm monorepo、`tsconfig.base.json`（strict）、ESLint（加上禁止 `innerHTML` 和 `dangerouslySetInnerHTML` 的規則）、Prettier、Vitest、Playwright（chromium、firefox、webkit）。
2. 用 `docker-compose` 起 Postgres 和 MinIO；`.env.example` 定義 `APP_ORIGIN`、`API_ORIGIN`、`CONTENT_BASE_DOMAIN`。
3. CI 跑 lint、typecheck、unit 和 e2e（含 security），產出 artifact。

**M1 安全核心（依賴 M0）**
4. `packages/shared`：zod schema（protocol、limits）。
5. `apps/content`：依 Host 解析版本（開發先用 FS 上的固定 fixture）、完整 header（見 Proposed Solution 第 2 節）、串流注入 agent。
6. `packages/frame-agent`：bridge、心跳、storage 和 dialog polyfill、導覽守衛；建置成 IIFE，加 bundle size 檢查。
7. `apps/web`：`SandboxFrame`（固定的 sandbox 和 allow 屬性）、`useFrameBridge`（檢查 source、大小、schema、頻率）、`FrameWatchdog`（load 後等 ready、心跳逾時就遮罩）。
8. 寫好 security suite（見 Verification 第 1 節）並全部通過。**這是門檻。**

**M2 匯入流程（依賴 M1）**
9. `StorageAdapter`（fs、s3）；寫 Drizzle schema 和 migrations。
10. `extractZip`（串流解壓，同時檢查大小、數量、壓縮比、路徑）；單一 HTML 和貼上原始碼包成只有一個檔的 bundle。
11. `analyze.ts`：用 parse5 掃描產生 `SecurityReport`；`entryDetect`（優先找 `index.html`，否則讓使用者選）。
12. `ImportDialog`、`SecurityReportPanel`、`CdnAllowlistPicker`（從預設清單勾選：Google Fonts、jsDelivr、unpkg、cdnjs、Tailwind Play CDN）。

**M3 Viewer（依賴 M2）**
13. `DeviceToolbar`（預設尺寸、自訂、縮放到符合畫面）、多頁導覽（收到 agent 的 `ready.pageId` 就同步頁面選單）、頂部的「不受信任內容」標示。

**M4 評論核心（依賴 M3）**
14. `packages/anchoring`：`describe` 和 `resolve`，加上 fingerprint 打分；用 jsdom 跑 fixture 單元測試。
15. agent 的 picker（元素、區域、文字三種模式，capture 攔截，`Alt` 暫時穿透）和 geometry（各種 observer 加 rAF 節流）。
16. `PinOverlay`、`HoverHighlight`；處理 scale、邊緣指示、各錨點狀態的樣式。
17. API：threads 和 comments 的 CRUD、專案內編號、狀態、標籤；`CommentSidebar`、`ThreadView`、`Composer`、`Filters`；快捷鍵和 a11y。

**M5 匯出（依賴 M4）**
18. `packages/exporter`：JSON（Web Annotation 相容）、Markdown、CSV（防公式注入）、Review Package ZIP；再匯入 Review Package。
19. `packages/export-viewer`：單檔 shell，`inlineAssets`（改寫 HTML 屬性、`srcset`、CSS `url()`、`@import` 為 `data:` URI），srcdoc 導覽，meta CSP，JSON 跳脫。
20. `ExportDialog`：選格式、篩選範圍、顯示預估大小。

**M6 分享與權限（依賴 M4，可以和 M5 平行）**
21. 擁有者登入（GitHub OAuth 或 Email magic link），session 用 HttpOnly + Secure + SameSite=Lax 的 cookie。
22. 分享連結：32-byte 隨機 token，DB 只存 sha256，可設角色、到期、撤銷；`GuestIdentityPrompt` 填名字，guestId 存在 localStorage；開啟頻率限制。
23. 審計日誌（記錄撤銷、刪除、換 contentKey）。

**M7 版本與遷移（P1）**
24. 上傳新版本時，在新版本上執行 `resolve`（用伺服器端 jsdom，或在背景開 headless frame），把未解決的討論串帶過去並標上 `carriedFrom.resolution`。
25. 版本並排比較檢視。

**M8 PNG/PDF render-worker（P1）**
26. 建立隔離容器（見 Impact）、Playwright 截全頁圖並畫上 pin、用 pdf-lib 組 PDF；用 `export_jobs` 排程。

**M9 強化與上線**
27. 把 CSP report 接進監控；檢舉和下架流程；（可選）ClamAV；負載測試；撰寫使用者文件，包括 prototype 相容性指南和 `data-comment-anchor` 的最佳做法。

---

## Verification

### 1. 惡意測試向量（Playwright，三種瀏覽器都要跑）
測試環境會另外起一個 **evil server**（`evil.localhost:6000`，記錄所有請求），主應用預先放一個 canary cookie 和一個 localStorage 值。每個向量的通過條件都是：**evil server 收到 0 個請求、canary 沒被改動、主應用 DOM 沒有被注入、沒有出現原生 dialog**，再加上表中各列的預期結果。

| # | 向量 | 預期 |
|---|---|---|
| V1 | `parent.document.cookie`、`top.document.body.innerHTML=…` | 丟出 `SecurityError` |
| V2 | `top.location='https://evil…'` | 被擋（沒有 `allow-top-navigation`） |
| V3 | `window.open('https://evil…')`、`<a target=_blank>` | 被擋（沒有 `allow-popups`） |
| V4 | `fetch`、`XMLHttpRequest`、`navigator.sendBeacon`、`new WebSocket` 打向 evil | 違反 CSP `connect-src` |
| V5 | `new Image().src`、CSS `background:url(evil)`、`@font-face` 指向 evil | 違反 `img-src`/`font-src` |
| V6 | 對 evil 送出 `<form>` | 被擋（沒有 `allow-forms`，加上 `form-action 'none'`） |
| V7 | `<base href=https://evil/>` | 違反 `base-uri` |
| V8 | `<iframe src=evil>`、`<object>`、`<embed>` | 違反 `frame-src`/`object-src` |
| V9 | `<meta http-equiv=refresh content="0;url=https://evil">`、`location.href=evil` | frame 自身導航到外部後，parent 在 1.5 秒內遮罩 frame（evil server 會收到 1 次導航請求，這是殘餘風險，test 要斷言遮罩有出現） |
| V10 | `while(true){}` | 主應用 UI 仍可操作（另一個 tab 的 input 有反應），心跳逾時後出現「停止 prototype」 |
| V11 | 迴圈呼叫 `alert()` | 不出現原生 dialog，toast 有節流 |
| V12 | 偽造 `parent.postMessage({v:1,type:'pick',draft:{…css:'<img src=x onerror=alert(1)>'}})` | schema 通過但以純文字顯示，主應用沒有執行任何 script |
| V13 | 送出超大或高頻訊息（1 MB 訊息、每秒 10,000 則） | 被丟棄或節流，主應用不卡 |
| V14 | prototype 監聽 message、印出所有 parent 來的訊息 | 測試讀取 frame 收到的訊息紀錄，斷言裡面**不含**任何 comment 內文、作者名或 token |
| V15 | 直接用網址開 content URL（不經 iframe），裡面有 `<script>` 試圖讀 storage | CSP sandbox header 生效，`localStorage` 丟錯 |
| V16 | 上傳含 `<script>` 的 SVG，直接開網址 | 和 V15 相同 |
| V17 | zip slip（`../../x`）、symlink、zip bomb（42.zip 類）、超過檔案數 | 匯入被拒，錯誤碼清楚 |
| V18 | `navigator.geolocation`、`getUserMedia`、`navigator.clipboard.readText` | 被 Permissions-Policy 拒絕 |
| V19 | comment 內文是 `<script>`、`[x](javascript:alert(1))`、`</script><script>` | 主應用、單檔 HTML 匯出、Markdown 匯出都沒有被執行 |
| V20 | CSV 匯出中 comment 為 `=HYPERLINK("evil")` | 儲存格開頭被加上 `'` |
| V21 | prototype 內含 `</script>`、`<!--`、`U+2028` 等字元，做單檔匯出 | 匯出檔結構完整，JSON 解析成功 |
| V22 | 打開單檔匯出檔，prototype 嘗試 fetch evil | 被 shell CSP `connect-src 'none'` 擋掉 |
| V23 | 用已撤銷的 shareToken 或已輪替的 contentKey 存取 | API 回 403，content 回 404 |
| V24 | 主應用被 `<iframe>` 嵌入（clickjacking） | 被 `frame-ancestors 'none'` 擋掉 |

### 2. 功能與錨定
- **錨定單元測試**：`tests/fixtures/anchoring` 至少 30 組 v1→v2 配對，涵蓋改 class、插入兄弟節點、改文案、把元素包進新 div、刪除元素、換 breakpoint 等情境。驗收：
  - 只改 class 或插入節點時，`exact` + `fuzzy` ≥ 95%。
  - 元素被刪除時一定得到 `fallback` 或 `orphaned`，不會誤判成 `exact`。
- **RWD**：同一則評論在 1440、768、390 三個寬度下，pin 中心都落在目標元素 bbox 內（e2e 斷言）。
- **端到端流程**：
  1. 擁有者匯入多頁 zip。
  2. 安全報告正確列出外部資源。
  3. 建立分享連結。
  4. 訪客開啟連結，留下元素、區域、文字三種評論。
  5. 擁有者回覆並標記解決。
  6. 匯出全部格式。
- **匯出往返**：匯出 Review Package 再匯入後，討論串數量、內容、錨點、狀態完全一致（deep equal，忽略 ID）。
- **單檔 HTML 離線**：以 `file://` 開啟，pin 數量等於評論數、多頁導覽正常、sidebar 篩選正常、網路請求為 0。
- **JSON**：用 ajv 對 `$schema` 驗證通過。

### 3. 效能與品質預算
- frame-agent ≤ 15 KB gzip。
- 200 個 pin 時，捲動中 geometry 更新到重新繪製 < 16 ms（Performance trace）。
- 50 MB zip 匯入完成 < 10 秒。
- Viewer 首次可互動 < 2.5 秒（本機）。
- a11y：axe 檢查主應用 0 個 critical；sidebar 和 pin 能完全只用鍵盤操作。

---

## Risks

| 風險 | 影響 | 緩解措施 / 殘餘風險 |
|---|---|---|
| frame 自身導航到外部頁面做釣魚（V9） | 中 | 用 ready 逾時加遮罩、固定的「不受信任內容」標示、擋掉 `allow-popups` 和 top navigation。**殘餘**：遮罩出現前（≤ 1.5 秒）外部頁面可能短暫顯示，外部伺服器也會收到一次請求（可以拿到審閱者 IP）。 |
| WebRTC、DNS prefetch 繞過 CSP 外送 | 低 | opaque origin 裡沒有敏感資料（comment 和身分都不進 frame），能外送的只有 IP 和行為。**殘餘**：已記錄在案，之後可以評估 `webrtc 'block'` 這類 CSP 指令的瀏覽器支援度。 |
| 瀏覽器在 sandbox 或 CSP 實作上的差異或漏洞 | 中 | 三種瀏覽器都進 CI；縱深防禦（跨 site + sandbox 屬性 + CSP sandbox header + 不傳機密給 frame），任一層失效其他層仍在。 |
| 錨點漂移（SPA 大量動態 DOM、自動生成的 class） | 中 | 多組 selector 加 fingerprint 加信心分數；UI 誠實顯示 `fuzzy`/`fallback`；鼓勵加 `data-comment-anchor`；`hidden` 狀態附 stateHint。P2 做互動路徑錄製。 |
| opaque origin 造成 prototype 相容性下降 | 中 | 提供 storage/cookie/dialog polyfill、CDN 白名單、匯入報告預先警告、相容性文件。**殘餘**：依賴 IndexedDB、Service Worker 或跨域 API 的 prototype 無法完整運作。 |
| render-worker 在伺服器執行不受信任程式碼（RCE、SSRF） | 高 | 排到 P1，獨立容器、egress 全封鎖、資源上限、非 root；MVP 不提供伺服器端渲染。 |
| capability URL（contentKey、shareToken）外洩 | 中 | `Referrer-Policy: no-referrer`、可輪替或撤銷、可設到期、token 只存 hash；審計日誌。 |
| 平台被濫用來託管惡意內容 | 中 | 預設需要登入才能上傳、檢舉和下架流程、可選 ClamAV、獨立網域保護主品牌的網域信譽。 |
| 單檔匯出檔太大、某些頁面改寫失敗 | 低 | 匯出前顯示預估大小並在 20 MB 警告；改寫失敗的資源列在匯出報告；另提供 Review Package ZIP。 |
| 範圍膨脹（即時協作、整合功能） | 中 | 嚴格守住 M0–M6 為 MVP，P1/P2 依本文件排序；M1 安全門檻不能跳過。 |
| 需要第二個網域、wildcard DNS 與憑證 | 低 | 開發用 `*.localhost`；部署前把網域和憑證列為上線前提，在 M9 的 checklist 確認。 |

### 後續演進建議（M9 之後）
1. **即時協作**：先用 SSE 推送新評論和狀態變更，再進一步用 WebSocket 加 Yjs awareness 做 presence 和即時游標。
2. **多頁和流程化原型**：支援頁面流程圖（從 `<a>` 連結自動生成）、在流程節點上評論，以及錄製互動路徑重播到特定狀態。
3. **整合**：評論一鍵開成 GitHub Issue、Jira 或 Linear 票（附截圖和 selector）；Slack 或 Email digest。
4. **AI 輔助**：彙整回饋、相似評論去重、依標籤或優先級自動分類（只送 comment 文字和 selector，不送 prototype 原始碼）。
5. **審閱流程**：審閱輪次（Round）、截止日、簽核（Approve）狀態，以及帶評論的版本差異報告。