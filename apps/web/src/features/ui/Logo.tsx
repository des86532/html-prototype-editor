/** 品牌標誌：四角裁切標記加箭頭（標記）。與 public/favicon.svg 相同；色值寫死，匯出檔也能獨立顯示。 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 32 32" className={className}>
      <rect width="32" height="32" rx="7" fill="#c2185b" />
      <path
        d="M8 12V8h4M20 8h4v4M24 20v4h-4M12 24H8v-4"
        fill="none"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 19l6-6m-4 0h4v4"
        fill="none"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
