# html-prototype-editor

匯入 HTML 原型、在畫面上直接留言（Pin / 區域 / 文字），並可連同留言匯出的審閱工具。匯入的 HTML 一律視為不受信任內容，在隔離沙箱中執行。

完整規格與實作計畫見 [docs/SPECIFICATION.md](docs/SPECIFICATION.md)（Issue #1）。目前實作範圍是規格的 **MVP（M0–M6）**；P1（版本遷移、拖曳 pin、PNG/PDF render-worker）與 P2 尚未實作。

## 架構

| 位置                     | 內容                                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`               | 主應用（React 19、Vite、Tailwind v4、TanStack Router/Query、Zustand）。嚴格 CSP（`vite preview`）、Trusted Types、所有使用者內容只走 `textContent` 或 sanitize 過的 markdown |
| `apps/api`               | Fastify + Drizzle + PostgreSQL：專案、版本匯入（串流解壓與全部上限）、threads/comments、分享連結與訪客、匯出、稽核日誌                                                       |
| `apps/content`           | prototype 內容伺服器（`{contentKey}.CONTENT_BASE_DOMAIN`）：逐字照規格的 CSP／Permissions-Policy header、串流注入 frame-agent                                                |
| `packages/shared`        | 型別與 zod schema（單一事實來源）、postMessage 協定 v1、REST 路由表、上限常數                                                                                                |
| `packages/anchoring`     | `describe` / `resolve`：dataAttr → css → xpath → textQuote（模糊）→ fingerprint → 座標 fallback，附信心分數                                                                  |
| `packages/frame-agent`   | 注入 frame 的 agent（IIFE ≈ 11.6 KB gzip，上限 15 KB）：bridge、心跳、storage/dialog polyfill、導覽守衛、picker、geometry                                                    |
| `packages/exporter`      | JSON（W3C Web Annotation）、Markdown、CSV（防公式注入）、單檔 HTML、Review Package ZIP                                                                                       |
| `packages/export-viewer` | 單檔匯出用的唯讀 shell（`vite-plugin-singlefile`），與主應用共用 pin／卡片／留言面板元件                                                                                     |

安全邊界在 parent：comment 內文、作者、token 永遠不送進 frame；frame 傳來的訊息一律經來源檢查、64 KB 上限、zod 驗證與 120 則/秒限流。

## 開發

需求：Node 22、pnpm 10、PostgreSQL（或 `docker compose up -d`）。

```bash
pnpm install
cp .env.example .env            # 依需要調整；SESSION_SECRET 至少 32 字元
createdb hpe_dev                 # 或使用 docker-compose.yml 的 postgres
pnpm db:migrate
pnpm --filter @hpe/frame-agent build
pnpm dev                         # web :5173、content :5174、api :5175
```

開發環境的 prototype 內容網域用 `*.localhost`（`content.localhost:5174`）；Chromium、Firefox 會把它解析到本機。登入使用 Email magic link，`DEV_MAGIC_LINK=true` 時 API 直接回傳連結（正式環境必須設定 SMTP，且不可開啟 DEV_MAGIC_LINK）。

### 環境變數

| 變數                                          | 說明                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `APP_ORIGIN` / `API_ORIGIN` / `API_PORT`      | 主應用與 API 的 origin、API port                                                                                               |
| `CONTENT_BASE_DOMAIN` / `CONTENT_PORT`        | prototype 內容網域（必須是獨立的可註冊網域，不能在主網域之下）與 port                                                          |
| `DATABASE_URL`                                | PostgreSQL 連線字串                                                                                                            |
| `STORAGE_DRIVER` / `STORAGE_FS_ROOT` / `S3_*` | 資產儲存：`fs`（預設）或 S3 相容（MinIO）                                                                                      |
| `SESSION_SECRET`                              | session 與訪客 token 簽章                                                                                                      |
| `DEV_MAGIC_LINK` / `SMTP_*`                   | magic link 寄送方式                                                                                                            |
| `INTERNAL_TOKEN` / `API_INTERNAL_ORIGIN`      | content server 呼叫 API 內部端點用，兩邊必須相同；`NODE_ENV=production` 時必填                                                 |
| `CONTENT_RESOLVE_CACHE_MS`                    | content server 對 contentKey 解析結果的快取（預設 0＝輪替立即生效）                                                            |
| `EXPORT_SHELL_PATH` / `AGENT_BUNDLE_PATH`     | 單檔匯出用的 shell 與 agent 建置產物（預設 `packages/export-viewer/dist/index.html`、`packages/frame-agent/dist/agent.v1.js`） |

單檔 HTML 匯出需要先建置 agent 與 shell：`pnpm --filter @hpe/frame-agent build && pnpm --filter @hpe/export-viewer build`。

## 測試

```bash
pnpm lint && pnpm typecheck && pnpm build
pnpm test            # vitest：shared、anchoring、frame-agent、content、api（需 PostgreSQL，預設 hpe_test）、exporter、export-viewer、web
pnpm test:security   # Playwright：惡意向量 V1–V16、V18、V23（content 端）、V24（M1 門檻，三種瀏覽器）
pnpm test:export     # Playwright（三種瀏覽器）：單檔 HTML 離線、V19/V21/V22
pnpm test:e2e        # Playwright（三種瀏覽器）：完整 stack — 匯入 → Figma 式留言 → RWD → 分享 → 訪客 → 解決 → 匯出 → 往返；
                     # 另含效能預算（200 pin）與品質預算（axe、鍵盤操作、Viewer 可互動時間、近 50 MB zip 匯入）
```

`test:e2e` 會自己建置並啟動 API、content server 與主應用（獨立 port 5183–5185、資料庫 `hpe_e2e`，每次重建 schema）。加上 `E2E_REUSE=1` 可沿用已在跑的 stack，`E2E_VERBOSE=1` 顯示各服務輸出。

## 已知限制

- axe 檢查 0 個 critical（規格要求）；Viewer 仍有 `color-contrast`、`label-content-name-mismatch` 兩項 serious（pin 的可見文字是縮寫與編號，與 aria-label 不一致）尚未處理。
- 尚未實作 P1：拖曳 pin 重新定位（協定中的 `describeAt` / `described` 與 `PATCH /threads/:id/anchor`）、版本管理與評論遷移、版本並排比較、PNG/PDF render-worker。
- iframe 內的鍵盤事件不會到達 parent，所以 `C`、`J`/`K`、`R`、`Esc` 等快捷鍵只在焦點位於主應用時有效。
- `S3Storage` 只以假 client 做過單元測試（本機沒有 MinIO）。
- **Safari／WebKit**：沒有 per-site iframe process，prototype 內的無窮迴圈會凍結整個分頁，watchdog 無法介入（security suite 的 V10 在 WebKit 以 skip 標示）；另外 WebKit 的 `connect-src 'self'` 在沙箱文件內不命中同 host，所以 content server 會額外列出該 contentKey 自己的 origin。詳見規格 Risks。
- V9（frame 自行導向外部網址）有殘餘風險：遮罩出現前（≤ 1.5 秒）外部頁面可能短暫顯示，外部伺服器可能收到一次請求。
