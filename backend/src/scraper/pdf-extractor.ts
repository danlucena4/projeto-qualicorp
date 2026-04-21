// Orquestra a extração de um PDF Qualicorp:
//  1) download com headers de browser (evita bloqueio do CloudFront);
//  2) parse via pdf-parser → estrutura pronta pro Koter;
//  3) persistência do JSON no qc_tables.pdf_extraction_json.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { parseQualicorpPdf, type ExtractedPDF } from './pdf-parser.js';
import { config } from '../config.js';

const PDFS_DIR = path.resolve(config.paths.dataDir, 'pdfs');
fs.mkdirSync(PDFS_DIR, { recursive: true });

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: 'https://qualivendas.qualicorp.com.br/',
  Accept: 'application/pdf,*/*',
};

function safeName(url: string): string {
  const base = url.split('/').pop() ?? 'file.pdf';
  return base.replace(/[^\w.\-]+/g, '_');
}

async function downloadPdf(url: string): Promise<{ buf: Uint8Array; localPath: string; sha: string }> {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  const buf = new Uint8Array(ab);
  // Header do PDF: %PDF-
  if (buf.length < 5 || String.fromCharCode(...buf.slice(0, 5)) !== '%PDF-') {
    throw new Error(`Resposta não é um PDF (primeiros bytes: "${String.fromCharCode(...buf.slice(0, 40))}")`);
  }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const localPath = path.join(PDFS_DIR, safeName(url));
  fs.writeFileSync(localPath, buf);
  return { buf, localPath, sha };
}

export interface ExtractionResult {
  qcTableId: number;
  extraction: ExtractedPDF;
  pdfLocalPath: string;
  pdfSha256: string;
}

export async function extractQcTable(qcTableId: number): Promise<ExtractionResult> {
  const row = db
    .prepare(
      `SELECT t.id, t.link_tabela, o.name AS operator_name
       FROM qc_tables t
       JOIN qc_operators o ON o.id = t.operator_id
       WHERE t.id = ?`,
    )
    .get(qcTableId) as { id: number; link_tabela: string | null; operator_name: string } | undefined;

  if (!row) throw new Error(`qc_table ${qcTableId} não existe`);
  if (!row.link_tabela) throw new Error(`qc_table ${qcTableId} não tem link_tabela`);

  try {
    const { buf, localPath, sha } = await downloadPdf(row.link_tabela);
    const extraction = await parseQualicorpPdf(buf);
    extraction.operatorHint = row.operator_name;

    db.prepare(
      `UPDATE qc_tables SET
        pdf_local_path = ?, pdf_sha256 = ?, pdf_downloaded_at = CURRENT_TIMESTAMP,
        pdf_extracted_at = CURRENT_TIMESTAMP,
        pdf_extraction_json = ?, pdf_extraction_error = NULL,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(localPath, sha, JSON.stringify(extraction), qcTableId);

    return { qcTableId, extraction, pdfLocalPath: localPath, pdfSha256: sha };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE qc_tables SET
        pdf_extraction_error = ?, pdf_extracted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(msg, qcTableId);
    throw err;
  }
}

export function getExtraction(qcTableId: number): ExtractedPDF | null {
  const row = db
    .prepare('SELECT pdf_extraction_json FROM qc_tables WHERE id = ?')
    .get(qcTableId) as { pdf_extraction_json: string | null } | undefined;
  if (!row || !row.pdf_extraction_json) return null;
  return JSON.parse(row.pdf_extraction_json) as ExtractedPDF;
}

// Opcional: extração em lote com concorrência limitada.
export async function extractBatch(
  qcTableIds: number[],
  concurrency = 3,
  onProgress?: (done: number, total: number, last?: { id: number; error?: string }) => void,
): Promise<{ ok: number; errors: Array<{ id: number; error: string }> }> {
  const queue = [...qcTableIds];
  let ok = 0;
  const errors: Array<{ id: number; error: string }> = [];
  let done = 0;
  const total = queue.length;

  async function worker() {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await extractQcTable(id);
        ok++;
        done++;
        onProgress?.(done, total, { id });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        errors.push({ id, error });
        done++;
        onProgress?.(done, total, { id, error });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return { ok, errors };
}
