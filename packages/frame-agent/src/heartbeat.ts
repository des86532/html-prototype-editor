import { PROTOCOL_VERSION } from '@hpe/shared';
import type { AgentModule } from './bridge-types.js';

/** 心跳：收到 `ping{seq}` 就回 `pong{seq}`。主執行緒被卡住時不會回，parent 據此判斷無回應。 */
export const installHeartbeat: AgentModule = (bridge) =>
  bridge.subscribe((msg) => {
    if (msg.type === 'ping') bridge.send({ v: PROTOCOL_VERSION, type: 'pong', seq: msg.seq });
  });
