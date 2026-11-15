import { z } from 'zod';
import { MARKUP_LIMITS } from './limits.js';
import { IdSchema, ThreadSchema } from './schemas.js';

/** 即時協作（WebSocket `/versions/:id/live`）的訊息協定。目前只在單一 API process 內廣播。 */
export const LIVE_PROTOCOL_VERSION = 1 as const;

export const LIVE_LIMITS = {
  maxClientMessageBytes: 4096,
  cursorPerSecond: 30,
  cursorSendIntervalMs: 50,
  helloTimeoutMs: 5000,
  heartbeatMs: 25_000,
  reconnectBaseMs: 1000,
  reconnectMaxMs: 30_000,
} as const;

/** WebSocket close code：這些不重連。 */
export const LIVE_CLOSE = {
  badRequest: 4400,
  unauthenticated: 4401,
  forbidden: 4403,
  gone: 4404,
} as const;

export const PeerSchema = z.object({
  /** 連線 id（同一人開兩個分頁就有兩個） */
  id: IdSchema,
  name: z.string().max(120),
  /** authorId；沒有身分的訪客用連線 id */
  colorKey: z.string().max(64),
  pageId: z.string().max(512).nullable(),
  width: z.number().int().nullable(),
});

const lv = z.literal(LIVE_PROTOCOL_VERSION);
const docCoord = z
  .number()
  .finite()
  .min(-MARKUP_LIMITS.maxCoordinate)
  .max(MARKUP_LIMITS.maxCoordinate);

export const LiveClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v: lv,
    type: z.literal('hello'),
    shareToken: z.string().max(512).optional(),
    guestToken: z.string().max(512).optional(),
  }),
  z.object({
    v: lv,
    type: z.literal('presence'),
    pageId: z.string().max(512).nullable(),
    width: z.number().int().min(0).max(MARKUP_LIMITS.maxViewport).nullable(),
  }),
  z.object({ v: lv, type: z.literal('cursor'), x: docCoord.nullable(), y: docCoord.nullable() }),
]);

export const LiveServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ v: lv, type: z.literal('welcome'), selfId: IdSchema, peers: z.array(PeerSchema) }),
  z.object({ v: lv, type: z.literal('peerJoin'), peer: PeerSchema }),
  z.object({
    v: lv,
    type: z.literal('peerUpdate'),
    id: IdSchema,
    pageId: z.string().max(512).nullable(),
    width: z.number().int().nullable(),
  }),
  z.object({ v: lv, type: z.literal('peerLeave'), id: IdSchema }),
  z.object({
    v: lv,
    type: z.literal('cursor'),
    id: IdSchema,
    x: z.number().nullable(),
    y: z.number().nullable(),
  }),
  z.object({ v: lv, type: z.literal('threadUpsert'), thread: ThreadSchema }),
  z.object({ v: lv, type: z.literal('threadDelete'), threadId: IdSchema }),
]);

export type Peer = z.infer<typeof PeerSchema>;
export type LiveClientMessage = z.infer<typeof LiveClientMessageSchema>;
export type LiveServerMessage = z.infer<typeof LiveServerMessageSchema>;
