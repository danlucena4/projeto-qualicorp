// Testa o parser nos PDFs de amostra e imprime resumo.
// Uso: npx tsx src/scripts/test-parser.ts

import fs from 'node:fs';
import path from 'node:path';
import { parseQualicorpPdf, type ExtractedPDF } from '../scraper/pdf-parser.js';

const PDFS_DIR = path.resolve(process.cwd(), 'data/pdfs');
const samples = [
  'sample_hapvida.pdf',
  'sample_sulamerica.pdf',
  'sample_unimed.pdf',
  'sample_onmed.pdf',
  'sample_unimed_jf.pdf',
];

function summarize(name: string, r: ExtractedPDF) {
  console.log('\n============================================================');
  console.log('📄', name);
  console.log('============================================================');
  console.log(
    `pages=${r.stats.pages}  textLen=${r.stats.textLength}  tables=${r.stats.tableBlocks}  products=${r.stats.products}  cities=${r.stats.citiesCount}  refnets=${r.stats.refnetsCount}`,
  );
  if (r.validityBaseMonth || r.validityPeriod) {
    console.log(`validade: base=${r.validityBaseMonth ?? '-'}  periodo=${r.validityPeriod ?? '-'}`);
  }
  if (r.stats.warnings.length) {
    console.log('⚠️  warnings:', r.stats.warnings.join(' | '));
  }

  console.log(`\n-- entidades (${r.entities.length}) --`);
  console.log(r.entities.slice(0, 8).map((e) => `  ${e.code} → ${(e.name ?? '').slice(0, 60)}`).join('\n'));
  if (r.entities.length > 8) console.log(`  ... +${r.entities.length - 8}`);

  console.log(`\n-- tabelas (${r.tables.length}) --`);
  r.tables.forEach((t, i) => {
    console.log(
      `  [${i + 1}] ${t.blockLabel}  copart=${t.includesCoparticipation ?? '?'}  produtos=${t.products.length}`,
    );
    t.products.forEach((p) => {
      console.log(
        `        - ${(p.rawName || '?').slice(0, 50).padEnd(50)}  ANS=${p.ansCode ?? '?'}  seg=${p.segment?.slice(0, 30) ?? '?'}  cov=${p.coverage ?? '?'}  acc=${p.accommodation ?? '-'}`,
      );
      console.log(
        `            preços: ${[
          p.prices.age0_18,
          p.prices.age19_23,
          p.prices.age24_28,
          p.prices.age29_33,
          p.prices.age34_38,
          p.prices.age39_43,
          p.prices.age44_48,
          p.prices.age49_53,
          p.prices.age54_58,
          p.prices.age59Upper,
        ].map((n) => n.toFixed(2)).join(' · ')}`,
      );
    });
  });

  console.log(`\n-- cidades (${r.cities.length}) --`);
  console.log(
    `  ${r.cities.slice(0, 12).map((c) => c.name).join(', ')}${r.cities.length > 12 ? ', ...' : ''}`,
  );

  console.log(`\n-- refnets (${r.refnets.length}) --`);
  const hosp = r.refnets.filter((r) => r.kind === 'HOSPITAL');
  const lab = r.refnets.filter((r) => r.kind === 'LAB');
  console.log(`  hospitais=${hosp.length}  labs=${lab.length}`);
  hosp.slice(0, 5).forEach((h) => {
    console.log(`    🏥 ${h.name} (${h.city ?? '?'}) ${h.specialties?.join('/') ?? ''}`);
  });
  lab.slice(0, 5).forEach((l) => {
    console.log(`    🧪 ${l.name} (${l.city ?? '?'})`);
  });
}

(async () => {
  for (const sample of samples) {
    const abs = path.join(PDFS_DIR, sample);
    if (!fs.existsSync(abs)) {
      console.log(`skip ${sample} (not found)`);
      continue;
    }
    const data = new Uint8Array(fs.readFileSync(abs));
    try {
      const result = await parseQualicorpPdf(data);
      summarize(sample, result);
    } catch (err) {
      console.error(`ERRO em ${sample}:`, (err as Error).message);
    }
  }
})();
