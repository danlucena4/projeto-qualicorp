import { EventEmitter } from 'node:events';
import { insertSyncEvent } from '../db/index.js';

export type SyncEvent =
  | { type: 'log'; runId: number; message: string; level?: 'info' | 'warn' | 'error' }
  | { type: 'progress'; runId: number; step: string; pct?: number; message?: string }
  | { type: 'mfa_required'; runId: number; reason?: string }
  | { type: 'mfa_received'; runId: number }
  | { type: 'status'; runId: number; status: string }
  | { type: 'error'; runId: number; message: string }
  | { type: 'done'; runId: number; stats: Record<string, number> };

class SyncBus extends EventEmitter {
  emitEvent(e: SyncEvent) {
    const payload = { ...e } as Record<string, unknown>;
    delete payload.type;
    delete payload.runId;
    insertSyncEvent(e.runId, e.type, 'message' in e ? e.message ?? null : null, payload);
    this.emit('event', e);
    this.emit(`run:${e.runId}`, e);
  }
}

export const syncBus = new SyncBus();
syncBus.setMaxListeners(100);
