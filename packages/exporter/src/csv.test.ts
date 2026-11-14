import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, buildCsv, csvCell, neutralizeFormula, quoteCsvField, toCsv } from './csv.js';
import { makeInput, makeThread } from './fixtures.js';

describe('formula injection (V20)', () => {
  it.each(['=HYPERLINK("evil")', '+1', '-2', '@SUM(A1)', '\tx', '\rx', ' =1+1', '\u00a0@x'])(
    'prefixes %j',
    (v) => {
      expect(neutralizeFormula(v)).toBe(`'${v}`);
    },
  );

  it.each(['hello', '', 'a=b', '1', 'x\t'])('leaves %j', (v) => {
    expect(neutralizeFormula(v)).toBe(v);
  });

  it('the =HYPERLINK cell is guarded and quoted', () => {
    expect(csvCell('=HYPERLINK("evil")')).toBe(`"'=HYPERLINK(""evil"")"`);
  });
});

describe('RFC 4180', () => {
  it('quotes only when needed', () => {
    expect(quoteCsvField('plain')).toBe('plain');
    expect(quoteCsvField('a,b')).toBe('"a,b"');
    expect(quoteCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(quoteCsvField('l1\nl2')).toBe('"l1\nl2"');
    expect(quoteCsvField('l1\rl2')).toBe('"l1\rl2"');
  });

  it('uses CRLF and optional BOM', () => {
    expect(
      toCsv([
        ['a', 1],
        ['b', 2],
      ]),
    ).toBe('a,1\r\nb,2\r\n');
    expect(toCsv([['a']], { bom: true }).startsWith('\uFEFF')).toBe(true);
  });
});

describe('buildCsv', () => {
  it('writes one row per thread with the documented columns', () => {
    const t = makeThread(2, {
      comments: [
        {
          id: 'a',
          threadId: 't2',
          author: { kind: 'user', userId: 'u', name: 'A' },
          body: '=HYPERLINK("evil")',
          createdAt: 'x',
        },
        {
          id: 'b',
          threadId: 't2',
          author: { kind: 'user', userId: 'u', name: 'B' },
          body: 'r,1',
          createdAt: 'y',
        },
      ],
    });
    const csv = buildCsv(makeInput([makeThread(3), t]));
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines[1]!.startsWith('2,index.html,open,bug,Alice,')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""evil"")"`);
    expect(csv).toContain('A: =HYPERLINK');
    expect(lines.filter((l) => l.startsWith('3,'))).toHaveLength(1);
    expect(lines[1]).toContain(',1280,');
  });
});
