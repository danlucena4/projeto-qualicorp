// Exporta N JSONs de amostra pra validação manual.
// Cria pasta audit-samples/ com um arquivo por id + um README com os links
// originais dos PDFs pra comparação lado-a-lado.
//
// Uso: npx tsx src/scripts/export-samples.ts <id1> <id2> ...

import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';

const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
if (ids.length === 0) {
  console.error('Uso: npx tsx src/scripts/export-samples.ts <id1> <id2> ...');
  process.exit(1);
}

const OUT = path.resolve(process.cwd(), 'audit-samples');
fs.mkdirSync(OUT, { recursive: true });

const readme: string[] = [];
readme.push('# Amostras para validação manual');
readme.push('');
readme.push('Abra cada JSON ao lado do PDF original e confira os campos.');
readme.push('');
readme.push('| # | Operadora · UF · Entidade | PDF original | JSON |');
readme.push('|---|---|---|---|');

for (const id of ids) {
  const row = db
    .prepare(
      `SELECT t.id, t.uf, t.link_tabela, t.pdf_extraction_json,
              o.name AS operator, e.name AS entity
       FROM qc_tables t
       JOIN qc_operators o ON o.id = t.operator_id
       JOIN qc_entities e ON e.id = t.entity_id
       WHERE t.id = ?`,
    )
    .get(id) as
    | {
        id: number;
        uf: string;
        link_tabela: string | null;
        pdf_extraction_json: string | null;
        operator: string;
        entity: string;
      }
    | undefined;

  if (!row || !row.pdf_extraction_json) {
    console.warn(`⏭️  id=${id} sem extração, pulando`);
    continue;
  }

  const extraction = JSON.parse(row.pdf_extraction_json);
  const fname = `${String(id).padStart(3, '0')}_${row.operator.replace(/[^\w]+/g, '_')}_${row.uf}_${row.entity.replace(/[^\w]+/g, '_')}.json`;
  const payload = {
    meta: {
      qcTableId: row.id,
      operator: row.operator,
      uf: row.uf,
      entity: row.entity,
      pdfUrl: row.link_tabela,
    },
    extraction,
  };
  fs.writeFileSync(path.join(OUT, fname), JSON.stringify(payload, null, 2), 'utf-8');
  readme.push(
    `| ${row.id} | ${row.operator} · ${row.uf} · ${row.entity} | [PDF](${row.link_tabela ?? '#'}) | \`${fname}\` |`,
  );
  console.log(`✅ ${fname}`);
}

fs.writeFileSync(path.join(OUT, 'README.md'), readme.join('\n') + '\n', 'utf-8');
console.log(`\n📁 Exportado em: ${OUT}`);
