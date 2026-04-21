import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

fs.mkdirSync(config.paths.dataDir, { recursive: true });

export const db = new DatabaseSync(config.paths.dbFile);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

const schemaSQL = fs.readFileSync(config.paths.schemaFile, 'utf-8');
db.exec(schemaSQL);

// Migrations defensivas: adiciona colunas novas em tabelas já existentes.
// Cada ALTER só falha se a coluna já existir — ignoramos nesse caso.
function tryAlter(sql: string) {
  try {
    db.exec(sql);
  } catch (e) {
    const msg = (e as Error).message;
    if (!/duplicate column name/i.test(msg)) throw e;
  }
}
tryAlter('ALTER TABLE qc_tables ADD COLUMN pdf_extracted_at TEXT');
tryAlter('ALTER TABLE qc_tables ADD COLUMN pdf_extraction_json TEXT');
tryAlter('ALTER TABLE qc_tables ADD COLUMN pdf_extraction_error TEXT');

console.log(`[db] ready: ${path.relative(process.cwd(), config.paths.dbFile)}`);

// ============================================================================
// Sync runs
// ============================================================================

export function insertSyncRun(status: string): number {
  const stmt = db.prepare('INSERT INTO sync_runs (status) VALUES (?)');
  const info = stmt.run(status);
  return Number(info.lastInsertRowid);
}

export function updateSyncRun(
  id: number,
  patch: { status?: string; error?: string | null; stats?: unknown; finishedAt?: boolean },
) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push('status = ?');
    vals.push(patch.status);
  }
  if (patch.error !== undefined) {
    sets.push('error = ?');
    vals.push(patch.error);
  }
  if (patch.stats !== undefined) {
    sets.push('stats = ?');
    vals.push(JSON.stringify(patch.stats));
  }
  if (patch.finishedAt) {
    sets.push('finished_at = CURRENT_TIMESTAMP');
  }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE sync_runs SET ${sets.join(', ')} WHERE id = ?`).run(
    ...(vals as never[]),
  );
}

export function insertSyncEvent(
  runId: number,
  type: string,
  message: string | null,
  payload?: unknown,
) {
  db.prepare(
    'INSERT INTO sync_events (run_id, type, message, payload) VALUES (?, ?, ?, ?)',
  ).run(runId, type, message, payload ? JSON.stringify(payload) : null);
}

export function listSyncRuns(limit = 20) {
  return db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?').all(limit);
}

export function getSyncRun(id: number) {
  const run = db.prepare('SELECT * FROM sync_runs WHERE id = ?').get(id);
  if (!run) return null;
  const events = db
    .prepare('SELECT * FROM sync_events WHERE run_id = ? ORDER BY id ASC')
    .all(id);
  return { ...run, events };
}

// ============================================================================
// Upserts camada raw Qualicorp
// ============================================================================

export function listStates(): Array<{ uf: string; name: string }> {
  return db.prepare('SELECT uf, name FROM qc_states ORDER BY uf').all() as Array<{
    uf: string;
    name: string;
  }>;
}

export function markStateSynced(uf: string) {
  db.prepare('UPDATE qc_states SET last_synced_at = CURRENT_TIMESTAMP WHERE uf = ?').run(uf);
}

export function upsertOperator(name: string, logoUrl: string | null): number {
  const existing = db
    .prepare('SELECT id FROM qc_operators WHERE name = ?')
    .get(name) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      'UPDATE qc_operators SET logo_url = COALESCE(?, logo_url), last_seen_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(logoUrl, existing.id);
    return existing.id;
  }
  const info = db
    .prepare('INSERT INTO qc_operators (name, logo_url) VALUES (?, ?)')
    .run(name, logoUrl);
  return Number(info.lastInsertRowid);
}

export function linkOperatorToState(uf: string, operatorId: number) {
  db.prepare(
    'INSERT OR IGNORE INTO qc_operators_by_state (uf, operator_id) VALUES (?, ?)',
  ).run(uf, operatorId);
}

export function upsertProfession(name: string): number {
  const existing = db
    .prepare('SELECT id FROM qc_professions WHERE name = ?')
    .get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO qc_professions (name) VALUES (?)').run(name);
  return Number(info.lastInsertRowid);
}

export function linkProfessionToState(uf: string, professionId: number) {
  db.prepare(
    'INSERT OR IGNORE INTO qc_professions_by_state (uf, profession_id) VALUES (?, ?)',
  ).run(uf, professionId);
}

export function upsertEntity(name: string, linkFiliacao: string | null): number {
  const existing = db
    .prepare('SELECT id FROM qc_entities WHERE name = ?')
    .get(name) as { id: number } | undefined;
  if (existing) {
    if (linkFiliacao) {
      db.prepare('UPDATE qc_entities SET link_filiacao = ? WHERE id = ?').run(
        linkFiliacao,
        existing.id,
      );
    }
    return existing.id;
  }
  const info = db
    .prepare('INSERT INTO qc_entities (name, link_filiacao) VALUES (?, ?)')
    .run(name, linkFiliacao);
  return Number(info.lastInsertRowid);
}

export function linkEntityToState(uf: string, entityId: number) {
  db.prepare('INSERT OR IGNORE INTO qc_entities_by_state (uf, entity_id) VALUES (?, ?)').run(
    uf,
    entityId,
  );
}

export interface QcTableUpsert {
  uf: string;
  operatorId: number;
  entityId: number;
  linkTabela?: string | null;
  linkAdesao?: string | null;
  linkFiliacao?: string | null;
  linkAditivo?: string | null;
  linkOutrosDocumentos?: string | null;
  publico?: number | null;
  rawJson?: unknown;
}

export function upsertQcTable(r: QcTableUpsert): number {
  const existing = db
    .prepare(
      'SELECT id FROM qc_tables WHERE uf = ? AND operator_id = ? AND entity_id = ?',
    )
    .get(r.uf, r.operatorId, r.entityId) as { id: number } | undefined;
  const raw = r.rawJson ? JSON.stringify(r.rawJson) : null;
  if (existing) {
    db.prepare(
      `UPDATE qc_tables SET
        link_tabela = ?, link_adesao = ?, link_filiacao = ?, link_aditivo = ?,
        link_outros_documentos = ?, publico = ?, raw_json = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(
      r.linkTabela ?? null,
      r.linkAdesao ?? null,
      r.linkFiliacao ?? null,
      r.linkAditivo ?? null,
      r.linkOutrosDocumentos ?? null,
      r.publico ?? null,
      raw,
      existing.id,
    );
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO qc_tables
        (uf, operator_id, entity_id, link_tabela, link_adesao, link_filiacao,
         link_aditivo, link_outros_documentos, publico, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.uf,
      r.operatorId,
      r.entityId,
      r.linkTabela ?? null,
      r.linkAdesao ?? null,
      r.linkFiliacao ?? null,
      r.linkAditivo ?? null,
      r.linkOutrosDocumentos ?? null,
      r.publico ?? null,
      raw,
    );
  return Number(info.lastInsertRowid);
}

// ============================================================================
// Queries para o frontend
// ============================================================================

export function listQcOperators() {
  return db
    .prepare(
      `SELECT o.id, o.name, o.logo_url,
              COUNT(DISTINCT obs.uf) AS states_count,
              COUNT(DISTINCT t.id) AS tables_count
       FROM qc_operators o
       LEFT JOIN qc_operators_by_state obs ON obs.operator_id = o.id
       LEFT JOIN qc_tables t ON t.operator_id = o.id
       GROUP BY o.id
       ORDER BY o.name`,
    )
    .all();
}

export function listQcEntities() {
  return db
    .prepare(
      `SELECT e.id, e.name, e.link_filiacao,
              COUNT(DISTINCT t.id) AS tables_count
       FROM qc_entities e
       LEFT JOIN qc_tables t ON t.entity_id = e.id
       GROUP BY e.id
       ORDER BY e.name`,
    )
    .all();
}

export function listQcTables(filters: {
  uf?: string;
  operatorId?: number;
  entityId?: number;
  limit?: number;
  offset?: number;
}) {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (filters.uf) {
    where.push('t.uf = ?');
    vals.push(filters.uf);
  }
  if (filters.operatorId) {
    where.push('t.operator_id = ?');
    vals.push(filters.operatorId);
  }
  if (filters.entityId) {
    where.push('t.entity_id = ?');
    vals.push(filters.entityId);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  vals.push(limit, offset);

  return db
    .prepare(
      `SELECT t.id, t.uf, t.link_tabela, t.link_adesao, t.link_filiacao,
              t.link_aditivo, t.link_outros_documentos, t.publico,
              t.pdf_local_path, t.pdf_downloaded_at,
              t.pdf_extracted_at, t.pdf_extraction_error,
              CASE WHEN t.pdf_extraction_json IS NOT NULL THEN 1 ELSE 0 END AS has_extraction,
              t.updated_at,
              o.id AS operator_id, o.name AS operator_name, o.logo_url,
              e.id AS entity_id, e.name AS entity_name
       FROM qc_tables t
       JOIN qc_operators o ON o.id = t.operator_id
       JOIN qc_entities e ON e.id = t.entity_id
       ${whereSql}
       ORDER BY t.uf, o.name, e.name
       LIMIT ? OFFSET ?`,
    )
    .all(...(vals as never[]));
}

export function countQcTables(filters: { uf?: string; operatorId?: number; entityId?: number }) {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (filters.uf) {
    where.push('uf = ?');
    vals.push(filters.uf);
  }
  if (filters.operatorId) {
    where.push('operator_id = ?');
    vals.push(filters.operatorId);
  }
  if (filters.entityId) {
    where.push('entity_id = ?');
    vals.push(filters.entityId);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM qc_tables ${whereSql}`)
    .get(...(vals as never[])) as { c: number };
  return row.c;
}

export function getCounts() {
  const q = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  return {
    states: q('SELECT COUNT(*) AS c FROM qc_states WHERE last_synced_at IS NOT NULL'),
    operators: q('SELECT COUNT(*) AS c FROM qc_operators'),
    professions: q('SELECT COUNT(*) AS c FROM qc_professions'),
    entities: q('SELECT COUNT(*) AS c FROM qc_entities'),
    tables: q('SELECT COUNT(*) AS c FROM qc_tables'),
  };
}
