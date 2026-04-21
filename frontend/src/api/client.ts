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
  pdf_extracted_at: string | null;
  pdf_extraction_error: string | null;
  has_extraction?: number;
  updated_at: string;
}

export interface ExtractionCounts {
  total: number;
  extracted: number;
  errors: number;
  pending: number;
}

export interface ExtractedProduct {
  rawName: string;
  ansCode: string | null;
  segment: string | null;
  coverage: string | null;
  accommodation: 'Apartamento' | 'Enfermaria' | null;
  prices: {
    age0_18: number;
    age19_23: number;
    age24_28: number;
    age29_33: number;
    age34_38: number;
    age39_43: number;
    age44_48: number;
    age49_53: number;
    age54_58: number;
    age59Upper: number;
  };
}

export interface ExtractedTable {
  blockLabel: string;
  includesCoparticipation: 'WITH' | 'WITHOUT' | 'PARTIAL' | null;
  products: ExtractedProduct[];
}

export interface ExtractedPDF {
  operatorHint: string | null;
  planNameHint: string | null;
  validityBaseMonth: string | null;
  validityPeriod: string | null;
  entities: Array<{ code: string; name?: string }>;
  tables: ExtractedTable[];
  cities: Array<{ name: string; state?: string }>;
  refnets: Array<{ name: string; city?: string; kind: 'HOSPITAL' | 'LAB' | 'UNKNOWN'; specialties?: string[] }>;
  stats: {
    pages: number;
    textLength: number;
    tableBlocks: number;
    products: number;
    citiesCount: number;
    refnetsCount: number;
    warnings: string[];
  };
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
  async extractPdf(qcTableId: number): Promise<{ ok: boolean; stats?: ExtractedPDF['stats']; error?: string }> {
    const r = await fetch(`${BASE}/api/pdfs/${qcTableId}/extract`, { method: 'POST' });
    return r.json();
  },
  async getExtraction(qcTableId: number): Promise<ExtractedPDF | null> {
    const r = await fetch(`${BASE}/api/pdfs/${qcTableId}/extraction`);
    if (!r.ok) return null;
    return r.json();
  },
  async extractionCounts(): Promise<ExtractionCounts> {
    const r = await fetch(`${BASE}/api/pdfs/counts`);
    return r.json();
  },
  async extractBatch(ids: number[], concurrency = 3): Promise<{ ok: number; errors: Array<{ id: number; error: string }> }> {
    const r = await fetch(`${BASE}/api/pdfs/extract-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, concurrency }),
    });
    return r.json();
  },
};
