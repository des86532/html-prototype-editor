import {
  MARKUP_COLORS,
  MARKUP_STROKES,
  type MarkupColor,
  type MarkupStroke,
  type MarkupTool,
} from '@hpe/shared';

export interface MarkupToolsProps {
  tool: MarkupTool | 'select';
  onTool: (t: MarkupTool | 'select') => void;
  color: MarkupColor;
  onColor: (c: MarkupColor) => void;
  stroke: MarkupStroke;
  onStroke: (s: MarkupStroke) => void;
  canUndo: boolean;
  onUndo: () => void;
}

const svgProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 18 18',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const TOOLS: { id: MarkupTool | 'select'; label: string; icon: React.ReactNode }[] = [
  {
    id: 'select',
    label: '選取（V）',
    icon: <path d="M4 3l9 5-4 1.5L7.5 14z" fill="currentColor" />,
  },
  { id: 'rect', label: '矩形（R）', icon: <rect x="3" y="4" width="12" height="10" /> },
  { id: 'arrow', label: '箭頭（A）', icon: <path d="M4 14L14 4M7 4h7v7" /> },
  { id: 'pen', label: '畫筆（P）', icon: <path d="M3 15l1-4 8-8 3 3-8 8z" /> },
  {
    id: 'highlighter',
    label: '螢光筆（H）',
    icon: <path d="M3 13h12" strokeWidth={6} strokeLinecap="butt" opacity={0.45} />,
  },
  {
    id: 'text',
    label: '文字（T）',
    icon: <path d="M4 4h10M9 4v11" />,
  },
];

const COLOR_NAMES: Record<MarkupColor, string> = {
  '#e5484d': '紅色',
  '#f76b15': '橙色',
  '#ffb224': '黃色',
  '#30a46c': '綠色',
  '#0091ff': '藍色',
  '#24211c': '黑色',
};

const STROKE_NAMES: Record<MarkupStroke, string> = { 2: '細', 4: '中', 8: '粗' };

const Divider = () => <div className="h-px w-full bg-line" />;

/** markup 模式的浮動工具盤：工具、顏色、粗細、復原。 */
export function MarkupTools({
  tool,
  onTool,
  color,
  onColor,
  stroke,
  onStroke,
  canUndo,
  onUndo,
}: MarkupToolsProps) {
  return (
    <div
      role="toolbar"
      aria-label="標記工具"
      aria-orientation="vertical"
      className="card absolute left-3 top-3 z-20 flex flex-col items-center gap-1 p-1 shadow-lg"
    >
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={tool === t.id}
          aria-label={t.label}
          title={t.label}
          onClick={() => onTool(t.id)}
          className="btn btn-ghost btn-sm btn-toggle size-8 p-0"
        >
          <svg {...svgProps}>{t.icon}</svg>
        </button>
      ))}
      <Divider />
      <div className="flex w-14 flex-wrap justify-center gap-1 py-0.5">
        {MARKUP_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={color === c}
            aria-label={COLOR_NAMES[c]}
            title={COLOR_NAMES[c]}
            onClick={() => onColor(c)}
            className={`size-6 rounded-full ${
              color === c ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : ''
            }`}
            style={{ background: c }}
          />
        ))}
      </div>
      <Divider />
      {MARKUP_STROKES.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={stroke === s}
          aria-label={STROKE_NAMES[s]}
          title={STROKE_NAMES[s]}
          onClick={() => onStroke(s)}
          className="btn btn-ghost btn-sm btn-toggle size-8 p-0"
        >
          <svg {...svgProps}>
            <path d="M3 9h12" strokeWidth={s} strokeLinecap="butt" />
          </svg>
        </button>
      ))}
      <button
        type="button"
        aria-label="復原（⌘Z）"
        title="復原（⌘Z）"
        disabled={!canUndo}
        onClick={onUndo}
        className="btn btn-ghost btn-sm size-8 p-0"
      >
        <svg {...svgProps}>
          <path d="M6 4L3 7l3 3M3 7h7a4 4 0 010 8H7" />
        </svg>
      </button>
    </div>
  );
}
