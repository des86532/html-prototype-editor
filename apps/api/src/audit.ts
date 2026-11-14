import type { DbLike } from './db/client.js';
import { auditLog } from './db/schema.js';
import { newId } from './ids.js';

export async function writeAudit(
  db: DbLike,
  entry: { actor: string; action: string; target?: string | null; meta?: Record<string, unknown> },
): Promise<void> {
  await db.insert(auditLog).values({
    id: newId(),
    actor: entry.actor,
    action: entry.action,
    target: entry.target ?? null,
    meta: entry.meta ?? {},
  });
}
