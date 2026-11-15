import { describe, expect, it } from 'vitest';
import { applyInsert, findTrigger } from './composerTrigger';

describe('findTrigger', () => {
  it('finds a color trigger with 0–6 hex chars after #', () => {
    expect(findTrigger('abc #12', 7)).toEqual({ kind: 'color', start: 4, query: '12' });
    expect(findTrigger('#', 1)).toEqual({ kind: 'color', start: 0, query: '' });
    expect(findTrigger('#e5484d', 7)).toMatchObject({ kind: 'color' });
    expect(findTrigger('#e5484d1', 8)).toBeNull();
    expect(findTrigger('#xyz', 4)).toBeNull();
  });

  it('requires line start, whitespace or an opening bracket before the trigger', () => {
    expect(findTrigger('a#12', 4)).toBeNull();
    expect(findTrigger('a@gu', 4)).toBeNull();
    expect(findTrigger('(#12', 4)).toMatchObject({ kind: 'color', start: 1 });
    expect(findTrigger('a\n@x', 4)).toMatchObject({ kind: 'mention', start: 2 });
  });

  it('finds a mention trigger; the query may contain spaces but not newlines, max 40', () => {
    expect(findTrigger('hi @gu', 6)).toEqual({ kind: 'mention', start: 3, query: 'gu' });
    expect(findTrigger('@Guest Gi', 9)).toMatchObject({ kind: 'mention', query: 'Guest Gi' });
    expect(findTrigger('@a\nb', 4)).toBeNull();
    expect(findTrigger(`@${'x'.repeat(41)}`, 42)).toBeNull();
  });

  it('only looks left of the caret', () => {
    expect(findTrigger('hi @gu there', 6)).toMatchObject({ query: 'gu' });
    expect(findTrigger('hi @gu', 2)).toBeNull();
  });
});

describe('applyInsert', () => {
  it('replaces the trigger and query, returning the new caret', () => {
    const t = findTrigger('hi @gu', 6)!;
    expect(applyInsert('hi @gu', t, '@Guest Gina ')).toEqual({
      value: 'hi @Guest Gina ',
      caret: 15,
    });
  });

  it('keeps text after the caret', () => {
    const t = findTrigger('a #12 b', 5)!;
    expect(applyInsert('a #12 b', t, '#e5484d')).toEqual({ value: 'a #e5484d b', caret: 9 });
  });
});
