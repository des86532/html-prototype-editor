import { forwardRef } from 'react';

export interface ExportSandboxFrameProps {
  /** 含 agent 的完整頁面 HTML（`injectAgent` 的輸出）。 */
  srcDoc: string;
  /** iframe 的實際渲染寬高（CSS px，scale 前） */
  width: number;
  height: number;
  scale: number;
}

/**
 * 與 live viewer 的 SandboxFrame 相同的固定屬性（`sandbox="allow-scripts"`、`allow=""`、no-referrer），
 * 差別只在用 `srcdoc` 而非 `src`。不接受 props 覆寫 sandbox。
 * srcdoc 文件會繼承 shell 的 meta CSP（connect-src 'none'…），所以 prototype 無法連網。
 */
export const ExportSandboxFrame = forwardRef<HTMLIFrameElement, ExportSandboxFrameProps>(
  function ExportSandboxFrame({ srcDoc, width, height, scale }, ref) {
    return (
      <div
        data-testid="sandbox-frame-wrapper"
        style={{
          width: width * scale,
          height: height * scale,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <iframe
          ref={ref}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          allow=""
          referrerPolicy="no-referrer"
          loading="eager"
          title="Prototype 預覽（不受信任內容）"
          style={{
            width,
            height,
            border: 0,
            background: '#fff',
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        />
      </div>
    );
  },
);
