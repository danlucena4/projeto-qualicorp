const BASE = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3001';

export interface SyncRun {
  id: number;
  status: 'RUNNING' | 'WAITING_MFA' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  started_at: string;
  finished_at: string | null;
  error: string | null;
  stats: string | null;
}

export interface Stats {
  states: number;
  operators: number;
  professions: number;
  entities: number;
  tables: number;
}

export interface QcState {
  uf: string;
  name: string;
}

export interface QcOperator {
  id: number;
  name: string;
  logo_url: string | null;
  states_count: number;
  tables_count: number;
}

export interface QcEntity {
  id: number;
  name: string;
  link_filiacao: string | null;
  tables_count: number;
}

export interface QcTable {
  id: number;
  uf: string;
  operator_id: number;
  operator_name: string;
  logo_url: string | null;
  entity_id: number;
  entity_name: string;
  link_tabela: string | null;
  link_adesao: string | null;
  link_filiacao: string | null;
  link_aditivo: string | null;
  link_outros_documentos: string | null;
  publico: number | null;
  pdf_local_path: string | null;
  updated_at: string;
}

export const api = {
  async startSync(): Promise<{ runId: number }> {
    const r = await fetch(`${BASE}/api/sync/start`, { method: 'POST' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async submitMfa(runId: number, code: string): Promise<void> {
    const r = await fetch(`${BASE}/api/sync/${runId}/mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!r.ok) throw new Error(await r.text());
  },
  async cancelSync(runId: number): Promise<void> {
    await fetch(`${BASE}/api/sync/${runId}/cancel`, { method: 'POST' });
  },
  async listSyncs(): Promise<SyncRun[]> {
    const r = await fetch(`${BASE}/api/sync`);
    return r.json();
  },
  streamSync(runId: number): EventSource {
    return new EventSource(`${BASE}/api/sync/${runId}/stream`);
  },
  async getStats(): Promise<Stats> {
    const r = await fetch(`${BASE}/api/plans/stats`);
    return r.json();
  },
  async listStates(): Promise<QcState[]> {
    const r = await fetch(`${BASE}/api/plans/states`);
    return r.json();
  },
  async listOperators(): Promise<QcOperator[]> {
    const r = await fetch(`${BASE}/api/plans/operators`);
    return r.json();
  },
  async listEntities(): Promise<QcEntity[]> {
    const r = await fetch(`${BASE}/api/plans/entities`);
    return r.json();
  },
  async listTables(filters: {
    uf?: string;
    operatorId?: number;
    entityId?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; items: QcTable[] }> {
    const q = new URLSearchParams();
    if (filters.uf) q.set('uf', filters.uf);
    if (filters.operatorId) q.set('operatorId', String(filters.operatorId));
    if (filters.entityId) q.set('entityId', String(filters.entityId));
    if (filters.limit) q.set('limit', String(filters.limit));
    if (filters.offset) q.set('offset', String(filters.offset));
    const r = await fetch(`${BASE}/api/plans/tables?${q}`);
    return r.json();
  },
};
