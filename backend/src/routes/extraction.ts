import { Router } from 'express';
import { extractQcTable, extractBatch, getExtraction } from '../scraper/pdf-extractor.js';
import { toKoterPayload } from '../scraper/koter-adapter.js';
import { db } from '../db/index.js';

export const extractionRouter = Router();

// Extrai 1 PDF pelo qc_table_id.
extractionRouter.post('/:id/extract', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await extractQcTable(id);
    res.json({
      ok: true,
      qcTableId: id,
      stats: result.extraction.stats,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Retorna a extração persistida (ou null).
extractionRouter.get('/:id/extraction', (req, res) => {
  const id = Number(req.params.id);
  const extraction = getExtraction(id);
  if (!extraction) {
    res.status(404).json({ error: 'Extração ainda não rodada pra essa tabela' });
    return;
  }
  res.json(extraction);
});

// Retorna o payload NO FORMATO KOTER (após adaptação).
extractionRouter.get('/:id/koter-payload', (req, res) => {
  const id = Number(req.params.id);
  const extraction = getExtraction(id);
  if (!extraction) {
    res.status(404).json({ error: 'Extração ainda não rodada pra essa tabela' });
    return;
  }
  const meta = db
    .prepare(
      `SELECT t.uf, t.link_tabela, o.name AS operator, e.name AS entity
       FROM qc_tables t
       JOIN qc_operators o ON o.id = t.operator_id
       JOIN qc_entities e ON e.id = t.entity_id
       WHERE t.id = ?`,
    )
    .get(id) as { uf: string; link_tabela: string | null; operator: string; entity: string } | undefined;
  if (!meta) {
    res.status(404).json({ error: 'qc_table não existe' });
    return;
  }
  const payload = toKoterPayload(extraction, {
    operatorName: meta.operator,
    uf: meta.uf,
    category: 'ADHESION',
    entityName: meta.entity,
    pdfUrl: meta.link_tabela ?? undefined,
  });
  res.json(payload);
});

// Lista agregada de status de extração por qc_table.
extractionRouter.get('/status', (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 200;
  const offset = req.query.offset ? Number(req.query.offset) : 0;
  const uf = req.query.uf ? String(req.query.uf) : null;

  const where = uf ? 'WHERE t.uf = ?' : '';
  const vals: unknown[] = uf ? [uf] : [];
  vals.push(limit, offset);

  const rows = db
    .prepare(
      `SELECT t.id, t.uf, t.link_tabela, o.name AS operator_name, e.name AS entity_name,
              t.pdf_extracted_at, t.pdf_extraction_error,
              CASE WHEN t.pdf_extraction_json IS NOT NULL THEN 1 ELSE 0 END AS has_extraction
       FROM qc_tables t
       JOIN qc_operators o ON o.id = t.operator_id
       JOIN qc_entities e ON e.id = t.entity_id
       ${where}
       ORDER BY t.uf, o.name, e.name
       LIMIT ? OFFSET ?`,
    )
    .all(...(vals as never[]));
  res.json(rows);
});

// Extrai em lote N ids. Body: { ids: number[], concurrency?: number }
extractionRouter.post('/extract-batch', async (req, res) => {
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  const concurrency = Number(req.body?.concurrency ?? 3);
  if (ids.length === 0) {
    res.status(400).json({ error: 'Lista de ids vazia' });
    return;
  }
  const result = await extractBatch(ids, concurrency);
  res.json(result);
});

// Counters globais (quantos já extraídos / pendentes / com erro).
extractionRouter.get('/counts', (_req, res) => {
  const row = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN pdf_extraction_json IS NOT NULL THEN 1 ELSE 0 END) AS extracted,
        SUM(CASE WHEN pdf_extraction_error IS NOT NULL THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN pdf_extracted_at IS NULL THEN 1 ELSE 0 END) AS pending
       FROM qc_tables
       WHERE link_tabela IS NOT NULL AND link_tabela <> ''`,
    )
    .get() as {
    total: number;
    extracted: number;
    errors: number;
    pending: number;
  };
  res.json(row);
});
