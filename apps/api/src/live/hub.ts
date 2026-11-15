import {
  LIVE_LIMITS,
  LIVE_PROTOCOL_VERSION,
  type LiveServerMessage,
  type TokenBucket,
  type Peer,
  type Thread,
} from '@hpe/shared';
import type { WebSocket } from 'ws';

export interface LiveConn {
  /** 連線 id（newId()） */
  id: string;
  socket: WebSocket;
  versionId: string;
  projectId: string;
  shareLinkId: string | null;
  sessionHash: string | null;
  peer: Peer;
  bucket: TokenBucket;
  alive: boolean;
}

const OPEN = 1;

/** 單一 process 的記憶體內即時協作中樞（符合目前單機部署）。 */
export class LiveHub {
  private readonly byVersion = new Map<string, Set<LiveConn>>();
  private readonly timer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => this.heartbeat(), LIVE_LIMITS.heartbeatMs);
    this.timer.unref();
  }

  private heartbeat(): void {
    for (const set of this.byVersion.values()) {
      for (const c of set) {
        if (!c.alive) {
          c.socket.terminate();
          continue;
        }
        c.alive = false;
        try {
          c.socket.ping();
        } catch {
          c.socket.terminate();
        }
      }
    }
  }

  private send(c: LiveConn, msg: LiveServerMessage): void {
    if (c.socket.readyState === OPEN) c.socket.send(JSON.stringify(msg));
  }

  private broadcast(versionId: string, msg: LiveServerMessage, except?: LiveConn): void {
    const set = this.byVersion.get(versionId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const c of set) {
      if (c !== except && c.socket.readyState === OPEN) c.socket.send(data);
    }
  }

  join(conn: LiveConn): void {
    let set = this.byVersion.get(conn.versionId);
    if (!set) {
      set = new Set();
      this.byVersion.set(conn.versionId, set);
    }
    this.send(conn, {
      v: LIVE_PROTOCOL_VERSION,
      type: 'welcome',
      selfId: conn.id,
      peers: [...set].map((c) => c.peer),
    });
    set.add(conn);
    conn.socket.on('pong', () => {
      conn.alive = true;
    });
    this.broadcast(
      conn.versionId,
      { v: LIVE_PROTOCOL_VERSION, type: 'peerJoin', peer: conn.peer },
      conn,
    );
  }

  leave(conn: LiveConn): void {
    const set = this.byVersion.get(conn.versionId);
    if (!set || !set.delete(conn)) return;
    if (set.size === 0) this.byVersion.delete(conn.versionId);
    this.broadcast(conn.versionId, { v: LIVE_PROTOCOL_VERSION, type: 'peerLeave', id: conn.id });
  }

  updatePresence(conn: LiveConn, pageId: string | null, width: number | null): void {
    conn.peer = { ...conn.peer, pageId, width };
    this.broadcast(
      conn.versionId,
      { v: LIVE_PROTOCOL_VERSION, type: 'peerUpdate', id: conn.id, pageId, width },
      conn,
    );
  }

  relayCursor(conn: LiveConn, x: number | null, y: number | null): void {
    if (!conn.bucket.take()) return;
    this.broadcast(
      conn.versionId,
      { v: LIVE_PROTOCOL_VERSION, type: 'cursor', id: conn.id, x, y },
      conn,
    );
  }

  threadUpserted(versionId: string, thread: Thread): void {
    this.broadcast(versionId, { v: LIVE_PROTOCOL_VERSION, type: 'threadUpsert', thread });
  }

  threadDeleted(versionId: string, threadId: string): void {
    this.broadcast(versionId, { v: LIVE_PROTOCOL_VERSION, type: 'threadDelete', threadId });
  }

  closeWhere(pred: (c: LiveConn) => boolean, code: number, reason: string): void {
    for (const set of [...this.byVersion.values()]) {
      for (const c of [...set]) {
        if (pred(c)) c.socket.close(code, reason);
      }
    }
  }

  close(): void {
    clearInterval(this.timer);
    for (const set of this.byVersion.values()) {
      for (const c of set) c.socket.terminate();
    }
    this.byVersion.clear();
  }
}
