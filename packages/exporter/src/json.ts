import { ANNOTATIONS_SCHEMA_URL } from '@hpe/shared';
import type { AnnotationItem, AnnotationsDocument, Thread } from '@hpe/shared';
import { exportedAt, sortThreads } from './common.js';
import type { ExportInput } from './types.js';

type Selector = AnnotationItem['target']['selector'][number];

function selectorsOf(t: Thread): Selector[] {
  const s = t.anchor.selectors;
  const out: Selector[] = [];
  if (s.css) out.push({ type: 'CssSelector', value: s.css });
  if (s.xpath) out.push({ type: 'XPathSelector', value: s.xpath });
  if (s.textQuote) {
    out.push({
      type: 'TextQuoteSelector',
      exact: s.textQuote.exact,
      prefix: s.textQuote.prefix,
      suffix: s.textQuote.suffix,
    });
  }
  return out;
}

function toItem(t: Thread): AnnotationItem {
  const person = (name: string) => ({ type: 'Person' as const, name });
  return {
    id: `urn:hpe:thread:${t.id}`,
    type: 'Annotation',
    motivation: 'commenting',
    created: t.createdAt,
    creator: person(t.createdBy.name),
    target: { source: t.anchor.pageId, selector: selectorsOf(t) },
    body: t.comments.map((c) => ({
      type: 'TextualBody' as const,
      value: c.body,
      format: 'text/plain' as const,
      creator: person(c.author.name),
      created: c.createdAt,
    })),
    'x-hpe:threadId': t.id,
    'x-hpe:number': t.number,
    'x-hpe:status': t.status,
    'x-hpe:tags': [...t.tags],
    'x-hpe:breakpoint': {
      width: t.anchor.viewport.width,
      ...(t.anchor.viewport.preset === undefined ? {} : { preset: t.anchor.viewport.preset }),
    },
    'x-hpe:anchor': t.anchor,
    'x-hpe:createdBy': t.createdBy,
    'x-hpe:comments': t.comments,
    ...(t.resolvedAt === undefined ? {} : { 'x-hpe:resolvedAt': t.resolvedAt }),
  };
}

export function buildAnnotationsDocument(input: ExportInput): AnnotationsDocument {
  const v = input.version;
  return {
    $schema: ANNOTATIONS_SCHEMA_URL,
    schemaVersion: 1,
    exportedAt: exportedAt(input),
    project: { id: input.project.id, name: input.project.name },
    version: { id: v.id, number: v.number, entryPage: v.entryPage, pages: v.pages },
    items: sortThreads(input.threads).map(toItem),
  };
}

export function toJson(doc: AnnotationsDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
