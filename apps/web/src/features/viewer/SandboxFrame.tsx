import { forwardRef } from 'react';

export interface SandboxFrameProps {
  /** `https://{contentKey}.{CONTENT_BASE_DOMAIN}/{pagePath}` */
  src: string;
  /** iframe 的實際渲染寬高（CSS px，scale 前） */
  width: number;
  height: number;
  /** 外層 `transform: scale()`，overlay 套同一個 scale */
  scale: number;
}

/**
 * 規格 D2／「iframe 屬性」：sandbox 與 allow 屬性固定寫死，不接受 props 覆寫。
 * 不加 allow-same-origin、allow-top-navigation*、allow-popups、allow-forms、allow-modals、allow-downloads。
 */
export const SandboxFrame = forwardRef<HTMLIFrameElement, SandboxFrameProps>(function SandboxFrame(
  { src, width, height, scale },
  ref,
) {
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
        src={src}
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
});
