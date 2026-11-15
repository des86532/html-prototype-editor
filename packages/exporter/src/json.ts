import { ANNOTATIONS_SCHEMA_URL } from '@hpe/shared';
import type { AnnotationItem, AnnotationsDocument, Thread } from '@hpe/shared';
import { exportedAt, markupBox, sortThreads } from './common.js';
import type { ExportInput } from './types.js';

function toItem(t: Thread): AnnotationItem {
  const b = markupBox(t.markup);
  const person = (name: string) => ({ type: 'Person' as const, name });
  return {
    id: `urn:hpe:thread:${t.id}`,
    type: 'Annotation',
    motivation: 'commenting',
    created: t.createdAt,
    creator: person(t.createdBy.name),
    target: {
      source: t.markup.pageId,
      selector: [
        {
          type: 'FragmentSelector',
          conformsTo: 'http://www.w3.org/TR/media-frags/',
          value: `xywh=${b.x},${b.y},${b.w},${b.h}`,
        },
      ],
    },
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
    'x-hpe:breakpoint': { width: t.markup.viewport.width, height: t.markup.viewport.height },
    'x-hpe:markup': t.markup,
    'x-hpe:createdBy': t.createdBy,
    'x-hpe:comments': t.comments,
    ...(t.resolvedAt === undefined ? {} : { 'x-hpe:resolvedAt': t.resolvedAt }),
  };
}

export function buildAnnotationsDocument(input: ExportInput): AnnotationsDocument {
  const v = input.version;
  return {
    $schema: ANNOTATIONS_SCHEMA_URL,
    schemaVersion: 2,
    exportedAt: exportedAt(input),
    project: { id: input.project.id, name: input.project.name },
    version: { id: v.id, number: v.number, entryPage: v.entryPage, pages: v.pages },
    items: sortThreads(input.threads).map(toItem),
  };
}

export function toJson(doc: AnnotationsDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
