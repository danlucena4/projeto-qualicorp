// Auditoria: compara as extrações JSON com o schema que o Koter espera
// (documentado em koter-back-office-agent/CLAUDE.md).
//
// Uso:
//   npx tsx src/scripts/audit-extractions.ts <id1> <id2> ...
//
// Se nenhum id for passado, audita as 10 primeiras tabelas com extração.

import { db } from '../db/index.js';
import type { ExtractedPDF } from '../scraper/pdf-parser.js';

// ---------------------------------------------------------------------------
// Enums aceitos pelo Koter (do CLAUDE.md e docstrings do MCP koter-cadastro)
// ---------------------------------------------------------------------------

// Coparticipação: WITH / WITHOUT / PARTIAL
const COPART_VALUES = new Set(['WITH', 'WITHOUT', 'PARTIAL']);

// contractType: COMPULSORY / VOLUNTARY / NOT_APPLICABLE
const CONTRACT_TYPES = new Set(['COMPULSORY', 'VOLUNTARY', 'NOT_APPLICABLE']);

// Padrões que o Koter aceita em SEGMENT (precisam bater via get_metadata_ids).
// Estas são variações comuns; o caller do Koter resolve para IDs.
const KNOWN_SEGMENT_PATTERNS = [
  /ambulatorial\s*\+\s*hospitalar\s+com\s+obstetr[íi]cia/i,
  /ambulatorial\s*\+\s*hospitalar\s+sem\s+obstetr[íi]cia/i,
  /ambulatorial\s*\+\s*hospitalar/i,
  /^ambulatorial$/i,
  /hospitalar\s+com\s+obstetr[íi]cia/i,
  /hospitalar\s+sem\s+obstetr[íi]cia/i,
  /^hospitalar$/i,
  /odontol[óo]gico/i,
];

// Abrangência (coverage) aceita.
const KNOWN_COVERAGE_PATTERNS = [
  /^nacional$/i,
  /^estadual$/i,
  /^municipal$/i,
  /grupo\s+de\s+munic[íi]pios/i,
  /grupo\s+de\s+estados/i,
];

const ACCOMMODATIONS = new Set(['Apartamento', 'Enfermaria']);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

type Severity = 'ok' | 'warn' | 'error' | 'gap';

interface Check {
  field: string;
  severity: Severity;
  message: string;
}

function checkPdf(
  meta: { id: number; operator: string; uf: string; entity: string },
  e: ExtractedPDF,
): Check[] {
  const checks: Check[] = [];
  const add = (field: string, severity: Severity, message: string) =>
    checks.push({ field, severity, message });

  // ---- Nível plano/tabela ----
  // plan.category: ADHESION é deduzido pelo contexto (Tabela de Vendas Qualicorp)
  add('plan.category', 'ok', 'ADHESION (implícito pelo contexto Qualicorp)');

  // plan.name / table.name (linha comercial) — não extraído ainda
  add('table.name', 'gap', 'linha comercial não extraída (Essencial/Premium/Nosso Plano/etc.) — fica dentro de rawName');

  // contractType: Adesão = NOT_APPLICABLE (implícito)
  add('table.contractType', 'ok', 'NOT_APPLICABLE (implícito — Adesão)');

  // associations: devem vir das entidades
  if (e.entities.length > 0) {
    add('table.associations', 'ok', `${e.entities.length} entidades extraídas (viram associations no Koter)`);
  } else {
    add('table.associations', 'error', 'NENHUMA entidade extraída — obrigatório para Adesão');
  }

  // minCoveredLives / maxCoveredLives — geralmente null em Adesão
  add('table.minCoveredLives/max', 'gap', 'Adesão geralmente não limita vidas — campo fica null (aceitável)');

  // ---- Tabelas de preços ----
  if (e.tables.length === 0) {
    add('tables', 'error', 'Nenhuma tabela de preços extraída');
    return checks;
  }

  let tableIdx = 0;
  for (const t of e.tables) {
    tableIdx++;
    const prefix = `tables[${tableIdx}]`;

    // includesCoparticipation
    if (t.includesCoparticipation && COPART_VALUES.has(t.includesCoparticipation)) {
      add(`${prefix}.includesCoparticipation`, 'ok', `${t.includesCoparticipation}`);
    } else {
      add(`${prefix}.includesCoparticipation`, 'warn', `ausente — não deu pra determinar do bloco "${t.blockLabel}"`);
    }

    if (t.products.length === 0) {
      add(`${prefix}.products`, 'error', 'nenhum produto extraído');
      continue;
    }

    // ---- Produtos ----
    let prodIdx = 0;
    for (const p of t.products) {
      prodIdx++;
      const pp = `${prefix}.products[${prodIdx}]`;

      // ansCode
      if (p.ansCode && /^\d{3}\.\d{3}\/\d{2}-\d$/.test(p.ansCode)) {
        // ok silencioso
      } else {
        add(`${pp}.ansCode`, 'error', `ANS inválido ou ausente: "${p.ansCode}"`);
      }

      // segment
      if (p.segment) {
        const matched = KNOWN_SEGMENT_PATTERNS.some((re) => re.test(p.segment!));
        if (!matched) {
          add(`${pp}.segment`, 'warn', `segment "${p.segment}" não casa com padrões conhecidos (talvez precise normalização)`);
        }
      } else {
        add(`${pp}.segment`, 'error', 'segment ausente');
      }

      // coverage
      if (p.coverage) {
        const matched = KNOWN_COVERAGE_PATTERNS.some((re) => re.test(p.coverage!));
        if (!matched) {
          add(`${pp}.coverage`, 'warn', `coverage "${p.coverage}" não casa com padrões conhecidos`);
        }
      } else {
        add(`${pp}.coverage`, 'error', 'coverage ausente');
      }

      // accommodation — pode ser null quando segment = Ambulatorial (sem internação)
      if (p.accommodation !== null) {
        if (!ACCOMMODATIONS.has(p.accommodation)) {
          add(`${pp}.accommodation`, 'error', `acomodação inválida: "${p.accommodation}"`);
        }
      } else {
        // null só é OK se segmento é puramente Ambulatorial
        const isAmb = p.segment && /^ambulatorial$/i.test(p.segment);
        if (!isAmb) {
          add(`${pp}.accommodation`, 'warn', `null em produto ${p.segment ?? '?'} — esperado Apartamento/Enfermaria`);
        }
      }

      // prices: 10 faixas, todas > 0, ordem crescente (na maioria dos casos)
      const prices = [
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
      ];
      const zeroes = prices.filter((v) => !v || v <= 0).length;
      if (zeroes > 0) {
        add(`${pp}.prices`, 'error', `${zeroes}/10 faixas com preço zerado/ausente`);
      }
      // sanity: preço deve ser >= anterior (na maioria dos planos ANS isso é regra)
      let violations = 0;
      for (let i = 1; i < prices.length; i++) {
        if (prices[i] < prices[i - 1]) violations++;
      }
      if (violations > 0) {
        add(`${pp}.prices`, 'warn', `${violations} faixa(s) com preço menor que a anterior (pode ser real, mas suspeito)`);
      }
    }
  }

  // ---- Cidades ----
  if (e.cities.length === 0) {
    add('cities', 'warn', 'nenhuma cidade extraída (PDF pode não ter área de comercialização)');
  }

  // ---- Rede ----
  if (e.refnets.length === 0) {
    add('refnets', 'gap', 'PDF não lista rede (só aponta pro site da operadora) — aceitável, refnets ficam vazios');
  }

  void meta; // não usado mas mantido para auditoria futura
  return checks;
}

function scoreChecks(checks: Check[]): { ok: number; warn: number; error: number; gap: number; total: number } {
  const out = { ok: 0, warn: 0, error: 0, gap: 0, total: checks.length };
  for (const c of checks) out[c.severity]++;
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2).map(Number).filter(Number.isInteger);

function listIds(): number[] {
  if (args.length) return args;
  const rows = db
    .prepare(
      `SELECT id FROM qc_tables WHERE pdf_extraction_json IS NOT NULL ORDER BY id LIMIT 10`,
    )
    .all() as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

const ids = listIds();
if (ids.length === 0) {
  console.error('Nenhuma extração encontrada. Rode extrações primeiro (POST /api/pdfs/:id/extract).');
  process.exit(1);
}

const aggregate = { ok: 0, warn: 0, error: 0, gap: 0, total: 0 };

for (const id of ids) {
  const row = db
    .prepare(
      `SELECT t.id, t.uf, t.pdf_extraction_json,
              o.name AS operator, e.name AS entity
       FROM qc_tables t
       JOIN qc_operators o ON o.id = t.operator_id
       JOIN qc_entities e ON e.id = t.entity_id
       WHERE t.id = ?`,
    )
    .get(id) as {
    id: number;
    uf: string;
    pdf_extraction_json: string | null;
    operator: string;
    entity: string;
  } | undefined;

  if (!row || !row.pdf_extraction_json) {
    console.log(`\n❌ id=${id}: sem extração. Pule.`);
    continue;
  }

  const extraction = JSON.parse(row.pdf_extraction_json) as ExtractedPDF;
  const checks = checkPdf(
    { id: row.id, operator: row.operator, uf: row.uf, entity: row.entity },
    extraction,
  );
  const score = scoreChecks(checks);

  aggregate.ok += score.ok;
  aggregate.warn += score.warn;
  aggregate.error += score.error;
  aggregate.gap += score.gap;
  aggregate.total += score.total;

  const status = score.error > 0 ? '❌ ERROS' : score.warn > 0 ? '⚠️  WARNS' : '✅ OK';
  console.log(
    `\n${status}  id=${row.id}  ${row.operator} · ${row.uf} · ${row.entity}  →  ok=${score.ok} gap=${score.gap} warn=${score.warn} error=${score.error}`,
  );
  console.log(
    `        produtos=${extraction.stats.products} tabelas=${extraction.stats.tableBlocks} cidades=${extraction.stats.citiesCount} refnets=${extraction.stats.refnetsCount}`,
  );

  // Mostra apenas warnings e errors; hides ok e gap pra focar
  const relevant = checks.filter((c) => c.severity === 'error' || c.severity === 'warn');
  for (const c of relevant) {
    const icon = c.severity === 'error' ? '  ✗' : '  ⚠';
    console.log(`${icon} [${c.field}] ${c.message}`);
  }
  if (relevant.length === 0) console.log('        (sem errors/warns)');
}

console.log('\n================================================================');
console.log('RESUMO GERAL');
console.log('================================================================');
console.log(`Total de PDFs auditados: ${ids.length}`);
console.log(`Checks totais:           ${aggregate.total}`);
console.log(`  ok:    ${aggregate.ok}`);
console.log(`  gap:   ${aggregate.gap}   (campos implícitos ou fora do escopo do parser)`);
console.log(`  warn:  ${aggregate.warn}  (funciona, mas vale refinar)`);
console.log(`  error: ${aggregate.error}  (precisa corrigir)`);

const healthy =
  aggregate.error === 0 ? '✅ OK' : aggregate.error < 5 ? '⚠️  pontuais' : '❌ problemas sistêmicos';
console.log(`\nVeredicto: ${healthy}`);
