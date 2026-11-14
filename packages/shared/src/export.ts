import { z } from 'zod';
import {
  AnchorSchema,
  AuthorSchema,
  CommentSchema,
  IdSchema,
  IsoDateSchema,
  PageInfoSchema,
  ThreadStatusSchema,
  ThreadTagSchema,
} from './schemas.js';

/**
 * annotations.json（規格第 5 節）：`items[]` 相容 W3C Web Annotation，
 * 並以 `x-hpe:` 延伸欄位承載狀態、標籤、breakpoint、編號，以及完整 Anchor／回覆串供無損再匯入。
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
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('CssSelector'), value: z.string() }),
        z.object({ type: z.literal('XPathSelector'), value: z.string() }),
        z.object({
          type: z.literal('TextQuoteSelector'),
          exact: z.string(),
          prefix: z.string(),
          suffix: z.string(),
        }),
      ]),
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
  'x-hpe:number': z.number().int().positive(),
  'x-hpe:status': ThreadStatusSchema,
  'x-hpe:tags': z.array(ThreadTagSchema),
  'x-hpe:breakpoint': z.object({ width: z.number(), preset: z.string().optional() }),
  'x-hpe:anchor': AnchorSchema,
  'x-hpe:createdBy': AuthorSchema,
  'x-hpe:comments': z.array(CommentSchema),
  'x-hpe:resolvedAt': IsoDateSchema.optional(),
});
export type AnnotationItem = z.infer<typeof AnnotationItemSchema>;

export const AnnotationsDocumentSchema = z.object({
  $schema: z.string(),
  schemaVersion: z.literal(1),
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

/** Review Package ZIP 的 manifest.json。bundle 在 `bundle/` 下，標註在 `annotations.json`。 */
export const ReviewPackageManifestSchema = z.object({
  format: z.literal('hpe-review-package'),
  formatVersion: z.literal(1),
  exportedAt: IsoDateSchema,
  projectName: z.string(),
  versionNumber: z.number().int().positive(),
  entryPage: z.string(),
  cdnAllowlist: z.array(z.string()),
  bundlePrefix: z.literal('bundle/'),
  annotationsPath: z.literal('annotations.json'),
});
export type ReviewPackageManifest = z.infer<typeof ReviewPackageManifestSchema>;
