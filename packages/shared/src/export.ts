import { z } from 'zod';
import {
  AuthorSchema,
  CommentSchema,
  IdSchema,
  IsoDateSchema,
  MarkupSchema,
  PageInfoSchema,
  ThreadStatusSchema,
} from './schemas.js';

/**
 * annotations.json（規格第 5 節）：`items[]` 相容 W3C Web Annotation，
 * 並以 `x-hpe:` 延伸欄位承載狀態、breakpoint、編號，以及完整 markup／回覆串。
 */
export const AnnotationItemSchema = z.object({
  id: z.string(),
  type: z.literal('Annotation'),
  motivation: z.literal('commenting'),
  created: IsoDateSchema,
  creator: z.object({ type: z.literal('Person'), name: z.string() }),
  target: z.object({
    source: z.string(),
    selector: z.array(
      z.object({
        type: z.literal('FragmentSelector'),
        conformsTo: z.literal('http://www.w3.org/TR/media-frags/'),
        /** `xywh=x,y,w,h`：標記外框，頁面座標、四捨五入成整數 */
        value: z.string(),
      }),
    ),
  }),
  body: z.array(
    z.object({
      type: z.literal('TextualBody'),
      value: z.string(),
      format: z.literal('text/plain'),
      creator: z.object({ type: z.literal('Person'), name: z.string() }),
      created: IsoDateSchema,
    }),
  ),
  'x-hpe:threadId': IdSchema,
  'x-hpe:number': z.number().int().positive().nullable(),
  'x-hpe:status': ThreadStatusSchema,
  'x-hpe:breakpoint': z.object({ width: z.number(), height: z.number() }),
  'x-hpe:markup': MarkupSchema,
  'x-hpe:createdBy': AuthorSchema,
  'x-hpe:comments': z.array(CommentSchema),
  'x-hpe:resolvedAt': IsoDateSchema.optional(),
});
export type AnnotationItem = z.infer<typeof AnnotationItemSchema>;

export const AnnotationsDocumentSchema = z.object({
  $schema: z.string(),
  schemaVersion: z.literal(2),
  exportedAt: IsoDateSchema,
  project: z.object({ id: IdSchema, name: z.string() }),
  version: z.object({
    id: IdSchema,
    number: z.number().int().positive(),
    entryPage: z.string(),
    pages: z.array(PageInfoSchema),
  }),
  items: z.array(AnnotationItemSchema),
});
export type AnnotationsDocument = z.infer<typeof AnnotationsDocumentSchema>;
