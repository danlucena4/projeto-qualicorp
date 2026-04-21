// Cross-check: compara o JSON extraído contra o texto bruto do PDF.
// Objetivo: provar que todo ANS, preço, cidade e entidade do JSON realmente
// aparece no PDF — fiscalizando que o parser não inventou nada.
//
// Uso: npx tsx src/scripts/cross-check.ts

import fs from 'node:fs';
import path from 'node:path';
import type { ExtractedPDF } from '../scraper/pdf-parser.js';

interface Pairing {
  jsonFile: string;
  pdfTextFile: string;
  label: string;
}

const SAMPLES_DIR = path.resolve(process.cwd(), 'audit-samples');
const TEXTS_DIR = path.resolve(process.cwd(), 'data/pdfs');

const pairings: Pairing[] = [
  {
    jsonFile: '001_HAPVIDA_AL_ABRABDIR.json',
    pdfTextFile: 'sample_hapvida.txt',
    label: 'HAPVIDA · AL · ABRABDIR',
  },
  {
    jsonFile: '115_SULAM_RICA_HOSPITALAR_BA_ABM.json',
    pdfTextFile: 'sample_sulamerica_ba.txt',
    label: 'SulAmérica · BA · ABM',
  },
  {
    jsonFile: '118_SEGUROS_UNIMED_BA_ABM.json',
    pdfTextFile: 'sample_unimed.txt',
    label: 'Seguros Unimed · BA · ABM',
  },
  {
    jsonFile: '135_ONMED_SAUDE_CLARO_BA_ABM.json',
    pdfTextFile: 'sample_onmed.txt',
    label: 'ONMED · BA · ABM',
  },
  {
    jsonFile: '164_LIV_SAUDE_CE_ABRACEM.json',
    pdfTextFile: 'QUALIPRO_LIV_SAUDE_FC_CE_25.txt',
    label: 'LIV Saúde · CE · ABRACEM',
  },
];

function normalizeText(t: string): string {
  // Mantém tudo casinhable mas colapsa espaços/tabs/newlines.
  return t.replace(/\s+/g, ' ');
}

function brPrice(n: number): string {
  // Converte 1261.13 → "1.261,13" OU "1261,13" (sem separador de milhar)
  const raw = n.toFixed(2).replace('.', ',');
  // tenta com separador de milhar também
  const withThousands = n.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  return `${raw}|${withThousands}`;
}

function priceInText(normalized: string, n: number): boolean {
  if (!n || n <= 0) return true; // preço zero → não valida
  const formats = brPrice(n).split('|');
  for (const f of formats) {
    if (normalized.includes(f)) return true;
  }
  return false;
}

interface Report {
  pair: string;
  totals: {
    ansChecked: number;
    ansFound: number;
    pricesChecked: number;
    pricesFound: number;
    citiesChecked: number;
    citiesFound: number;
    entitiesChecked: number;
    entitiesFound: number;
    tableMetaChecked: number;
    tableMetaFound: number;
  };
  mismatches: string[];
}

function checkPair(p: Pairing): Report {
  const jsonPath = path.join(SAMPLES_DIR, p.jsonFile);
  const pdfTextPath = path.join(TEXTS_DIR, p.pdfTextFile);

  const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as {
    extraction: ExtractedPDF;
  };
  const extraction = payload.extraction;
  const pdfText = fs.readFileSync(pdfTextPath, 'utf-8');
  const normalized = normalizeText(pdfText);

  const r: Report = {
    pair: p.label,
    totals: {
      ansChecked: 0,
      ansFound: 0,
      pricesChecked: 0,
      pricesFound: 0,
      citiesChecked: 0,
      citiesFound: 0,
      entitiesChecked: 0,
      entitiesFound: 0,
      tableMetaChecked: 0,
      tableMetaFound: 0,
    },
    mismatches: [],
  };

  // ANS + preços + metadados de cada produto
  for (let ti = 0; ti < extraction.tables.length; ti++) {
    const t = extraction.tables[ti];
    for (let pi = 0; pi < t.products.length; pi++) {
      const prod = t.products[pi];
      if (prod.ansCode) {
        r.totals.ansChecked++;
        if (normalized.includes(prod.ansCode)) r.totals.ansFound++;
        else r.mismatches.push(`tabela[${ti + 1}].produto[${pi + 1}] ANS "${prod.ansCode}" NÃO encontrado no PDF`);
      }

      const prices = [
        prod.prices.age0_18,
        prod.prices.age19_23,
        prod.prices.age24_28,
        prod.prices.age29_33,
        prod.prices.age34_38,
        prod.prices.age39_43,
        prod.prices.age44_48,
        prod.prices.age49_53,
        prod.prices.age54_58,
        prod.prices.age59Upper,
      ];
      for (let i = 0; i < prices.length; i++) {
        if (prices[i] <= 0) continue;
        r.totals.pricesChecked++;
        if (priceInText(normalized, prices[i])) {
          r.totals.pricesFound++;
        } else {
          r.mismatches.push(
            `tabela[${ti + 1}].produto[${pi + 1}] preço faixa[${i}]=${prices[i]} NÃO encontrado no PDF`,
          );
        }
      }

      // Metadados: segment, coverage, accommodation
      if (prod.segment) {
        r.totals.tableMetaChecked++;
        const segCore = prod.segment.replace(/\s+/g, ' ');
        const simplifiedSeg = segCore.split(' ').slice(0, 2).join(' '); // primeiras 2 palavras
        if (normalized.toLowerCase().includes(simplifiedSeg.toLowerCase())) r.totals.tableMetaFound++;
        else r.mismatches.push(`tabela[${ti + 1}].produto[${pi + 1}] segment "${prod.segment}" (prefixo "${simplifiedSeg}") NÃO encontrado`);
      }
      if (prod.coverage) {
        r.totals.tableMetaChecked++;
        if (normalized.toLowerCase().includes(prod.coverage.toLowerCase())) r.totals.tableMetaFound++;
        else r.mismatches.push(`tabela[${ti + 1}].produto[${pi + 1}] coverage "${prod.coverage}" NÃO encontrado`);
      }
      if (prod.accommodation) {
        r.totals.tableMetaChecked++;
        // PDF usa "Individual/Coletivo" — mapeamos pra Apartamento/Enfermaria
        const lookFor = prod.accommodation === 'Apartamento' ? ['individual', 'apart'] : ['coletiv', 'enferm'];
        if (lookFor.some((k) => normalized.toLowerCase().includes(k))) r.totals.tableMetaFound++;
        else r.mismatches.push(`tabela[${ti + 1}].produto[${pi + 1}] accommodation "${prod.accommodation}" NÃO encontrado`);
      }
    }
  }

  // Cidades
  for (const c of extraction.cities) {
    r.totals.citiesChecked++;
    if (normalized.includes(c.name)) r.totals.citiesFound++;
    else r.mismatches.push(`cidade "${c.name}" NÃO encontrada`);
  }

  // Entidades (apenas código/sigla)
  for (const e of extraction.entities) {
    r.totals.entitiesChecked++;
    if (normalized.includes(e.code)) r.totals.entitiesFound++;
    else r.mismatches.push(`entidade "${e.code}" NÃO encontrada`);
  }

  return r;
}

function pct(a: number, b: number): string {
  if (b === 0) return '—';
  return `${((a / b) * 100).toFixed(1)}%`;
}

function formatReport(r: Report): string {
  const t = r.totals;
  const lines: string[] = [];
  lines.push(`\n========================================================`);
  lines.push(`📄 ${r.pair}`);
  lines.push(`========================================================`);
  lines.push(`ANS codes:    ${t.ansFound}/${t.ansChecked}   (${pct(t.ansFound, t.ansChecked)})`);
  lines.push(`Preços:       ${t.pricesFound}/${t.pricesChecked}   (${pct(t.pricesFound, t.pricesChecked)})`);
  lines.push(`Metadados:    ${t.tableMetaFound}/${t.tableMetaChecked}   (${pct(t.tableMetaFound, t.tableMetaChecked)})`);
  lines.push(`Cidades:      ${t.citiesFound}/${t.citiesChecked}   (${pct(t.citiesFound, t.citiesChecked)})`);
  lines.push(`Entidades:    ${t.entitiesFound}/${t.entitiesChecked}   (${pct(t.entitiesFound, t.entitiesChecked)})`);
  if (r.mismatches.length > 0) {
    lines.push(`\n⚠ Mismatches (${r.mismatches.length}):`);
    r.mismatches.slice(0, 15).forEach((m) => lines.push(`   · ${m}`));
    if (r.mismatches.length > 15) lines.push(`   ... +${r.mismatches.length - 15}`);
  } else {
    lines.push(`\n✅ Sem mismatches.`);
  }
  return lines.join('\n');
}

const reports = pairings.map(checkPair);
for (const r of reports) console.log(formatReport(r));

// Sumário final
const agg = reports.reduce(
  (acc, r) => {
    acc.ansChecked += r.totals.ansChecked;
    acc.ansFound += r.totals.ansFound;
    acc.pricesChecked += r.totals.pricesChecked;
    acc.pricesFound += r.totals.pricesFound;
    acc.citiesChecked += r.totals.citiesChecked;
    acc.citiesFound += r.totals.citiesFound;
    acc.entitiesChecked += r.totals.entitiesChecked;
    acc.entitiesFound += r.totals.entitiesFound;
    acc.metaChecked += r.totals.tableMetaChecked;
    acc.metaFound += r.totals.tableMetaFound;
    return acc;
  },
  {
    ansChecked: 0, ansFound: 0, pricesChecked: 0, pricesFound: 0,
    citiesChecked: 0, citiesFound: 0, entitiesChecked: 0, entitiesFound: 0,
    metaChecked: 0, metaFound: 0,
  },
);

console.log(`\n========================================================`);
console.log('SUMÁRIO GERAL');
console.log(`========================================================`);
console.log(`ANS codes:  ${agg.ansFound}/${agg.ansChecked}   ${pct(agg.ansFound, agg.ansChecked)}`);
console.log(`Preços:     ${agg.pricesFound}/${agg.pricesChecked}   ${pct(agg.pricesFound, agg.pricesChecked)}`);
console.log(`Metadados:  ${agg.metaFound}/${agg.metaChecked}   ${pct(agg.metaFound, agg.metaChecked)}`);
console.log(`Cidades:    ${agg.citiesFound}/${agg.citiesChecked}   ${pct(agg.citiesFound, agg.citiesChecked)}`);
console.log(`Entidades:  ${agg.entitiesFound}/${agg.entitiesChecked}   ${pct(agg.entitiesFound, agg.entitiesChecked)}`);
