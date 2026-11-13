import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { AnchorSchema, type Anchor } from '@hpe/shared';
import { describe as suite, expect, it } from 'vitest';
import { describe, rectForAnchor, resolve } from './index.js';
import { fakeMeasure, load, selectText } from './testUtil.js';

const DIR = resolvePath(import.meta.dirname, '../../../tests/fixtures/anchoring');

interface Pair {
  id: string;
  v1: string;
  v2: string;
  cat: string;
  kind: 'element' | 'region' | 'text';
  expect: string[];
  target: boolean;
  select?: string;
  expectRange?: boolean;
  docSize?: { w: number; h: number };
  v1Viewport?: number;
  v2Viewport?: number;
  stateInDialog?: boolean;
}

const { pairs } = JSON.parse(readFileSync(resolvePath(DIR, 'pairs.json'), 'utf8')) as {
  pairs: Pair[];
};
const read = (p: string) => readFileSync(resolvePath(DIR, p), 'utf8');

function run(p: Pair) {
  const w1 = p.v1Viewport ?? 1440;
  const w2 = p.v2Viewport ?? 1440;
  const m1 = fakeMeasure(w1);
  const m2 = fakeMeasure(w2);
  const doc1 = load(read(p.v1));
  const el = doc1.querySelector('[data-pick]');
  if (!el) throw new Error(`${p.id}: no [data-pick] in v1`);
  const bbox = m1(el)!;
  const { anchor: raw, rect } = describe({
    element: el,
    kind: p.kind,
    pageId: 'index.html',
    viewport: { width: w1, height: 900, dpr: 1 },
    point: { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 },
    region:
      p.kind === 'region'
        ? { x: bbox.x + bbox.w * 0.1, y: bbox.y + bbox.h * 0.2, w: bbox.w * 0.5, h: bbox.h * 0.5 }
        : undefined,
    range: p.kind === 'text' && p.select ? selectText(el, p.select) : undefined,
    measureRange: () => ({ x: bbox.x + 10, y: bbox.y, w: 80, h: 18 }),
    measure: m1,
  });
  const anchor = AnchorSchema.parse(JSON.parse(JSON.stringify(raw))) as Anchor;
  const doc2 = load(read(p.v2));
  const result = resolve(anchor, doc2, {
    measure: m2,
    viewportSize: { w: w2, h: 900 },
    docSize: p.docSize,
  });
  return { anchor, rect, result, doc2, m2, bbox };
}

suite('anchoring fixtures v1 → v2', () => {
  it('has at least 30 pairs, each with both files', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(30);
  });

  for (const p of pairs) {
    it(`${p.id} → ${p.expect.join('|')}`, () => {
      const { anchor, result, doc2, m2 } = run(p);
      expect(p.expect, `status=${result.status} conf=${result.confidence.toFixed(2)}`).toContain(
        result.status,
      );
      if (p.target) {
        expect(
          result.element?.hasAttribute('data-expect'),
          `${p.id} wrong element: ${result.element?.outerHTML}`,
        ).toBe(true);
      }
      if (p.expect.includes('exact') && !p.expect.includes('fuzzy'))
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      if (result.status === 'fuzzy') {
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
        expect(result.confidence).toBeLessThan(0.9);
      }
      if (p.stateInDialog) expect(anchor.stateHint?.inDialog).toBe(true);
      if (p.expectRange) expect(result.range).toBeTruthy();
      const r = rectForAnchor(anchor, result, doc2, {
        measure: m2,
        measureRange: () => ({ x: 1, y: 2, w: 3, h: 4 }),
        docSize: p.docSize,
      });
      if (result.status === 'hidden' || result.status === 'orphaned') expect(r).toBeNull();
      else expect(r).not.toBeNull();
    });
  }

  it('class-only and sibling-inserted pairs resolve as exact/fuzzy on the right element ≥ 95%', () => {
    const group = pairs.filter((p) => p.cat === 'class' || p.cat === 'sibling');
    expect(group.length).toBeGreaterThanOrEqual(10);
    const ok = group.filter((p) => {
      const { result } = run(p);
      return (
        (result.status === 'exact' || result.status === 'fuzzy') &&
        result.element?.hasAttribute('data-expect')
      );
    });
    expect(ok.length / group.length).toBeGreaterThanOrEqual(0.95);
  });

  it('a deleted element is always fallback or orphaned, never exact', () => {
    const group = pairs.filter((p) => p.cat === 'deleted' || p.id.endsWith('text-deleted'));
    expect(group.length).toBeGreaterThanOrEqual(6);
    for (const p of group) {
      const { result } = run(p);
      expect(['fallback', 'orphaned'], p.id).toContain(result.status);
    }
  });

  it('breakpoint change: same element, different rect', () => {
    const p = pairs.find((x) => x.id.endsWith('breakpoint-narrow'))!;
    const { rect, result } = run(p);
    expect(result.status).toBe('exact');
    expect(result.rect!.w).toBeLessThan(rect.w);
  });

  it('region anchors resolve to the stored sub-rectangle of the element bbox', () => {
    const p = pairs.find((x) => x.id.endsWith('region-class-changed'))!;
    const { anchor, rect, result, doc2, m2 } = run(p);
    const box = rectForAnchor(anchor, result, doc2, { measure: m2 })!;
    const bb = m2(result.element!)!;
    expect(box.w).toBeCloseTo(0.5 * bb.w, 5);
    expect(box.h).toBeCloseTo(0.5 * bb.h, 5);
    expect(rect.w).toBeGreaterThan(0);
  });
});
