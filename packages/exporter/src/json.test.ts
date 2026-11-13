import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { AnnotationsDocumentSchema, ANNOTATIONS_SCHEMA_URL } from '@hpe/shared';
import { describe, expect, it } from 'vitest';
import { buildAnnotationsDocument, toJson } from './json.js';
import { HOSTILE_BODIES, makeAnchor, makeInput, makeThread } from './fixtures.js';

const schema = JSON.parse(
  readFileSync(new URL('../schema/annotations.v1.json', import.meta.url), 'utf8'),
) as object;

function validator() {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

describe('buildAnnotationsDocument', () => {
  const threads = [
    makeThread(2, { status: 'resolved', resolvedAt: '2026-02-03T00:00:00Z' }),
    makeThread(1, { anchor: makeAnchor({ viewport: { width: 375, height: 700, dpr: 3 } }) }),
  ];
  const doc = buildAnnotationsDocument(makeInput(threads));

  it('has $schema, version and W3C annotation shape', () => {
    expect(doc.$schema).toBe(ANNOTATIONS_SCHEMA_URL);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.exportedAt).toBe('2026-03-01T08:30:00.000Z');
    expect(doc.items.map((i) => i['x-hpe:number'])).toEqual([1, 2]);
    const item = doc.items[1]!;
    expect(item.type).toBe('Annotation');
    expect(item.motivation).toBe('commenting');
    expect(item.target.source).toBe('index.html');
    expect(item.target.selector.map((s) => s.type)).toEqual([
      'CssSelector',
      'XPathSelector',
      'TextQuoteSelector',
    ]);
    expect(item.body.map((b) => b.value)).toEqual(['first 2', 'reply 2']);
    expect(item['x-hpe:resolvedAt']).toBe('2026-02-03T00:00:00Z');
    expect(doc.items[0]!['x-hpe:breakpoint']).toEqual({ width: 375 });
  });

  it('validates against zod and the shipped JSON Schema (ajv 2020)', () => {
    expect(AnnotationsDocumentSchema.safeParse(doc).success).toBe(true);
    const validate = validator();
    expect(validate(JSON.parse(toJson(doc)))).toBe(true);
  });

  it('JSON Schema rejects broken documents', () => {
    const validate = validator();
    expect(validate({ ...doc, schemaVersion: 2 })).toBe(false);
    expect(validate({ ...doc, items: [{ ...doc.items[0], type: 'Note' }] })).toBe(false);
    const { project: _p, ...noProject } = doc;
    expect(validate(noProject)).toBe(false);
  });

  it('keeps hostile text verbatim as data', () => {
    const t = makeThread(1, {
      comments: HOSTILE_BODIES.map((body, i) => ({
        id: `c${i}`,
        threadId: 't1',
        author: { kind: 'user' as const, userId: 'u', name: 'A' },
        body,
        createdAt: '2026-02-01T00:00:00Z',
      })),
    });
    const parsed = JSON.parse(toJson(buildAnnotationsDocument(makeInput([t]))));
    expect(parsed.items[0].body.map((b: { value: string }) => b.value)).toEqual(HOSTILE_BODIES);
  });
});
