// Parser de PDFs de tabela de vendas Qualicorp → estrutura pronta pro Koter.
//
// Baseado em inspeção manual de 4 PDFs (HAPVIDA/AL, SULAMÉRICA/AL, ONMED/BA,
// UNIMED-JF/MG, SEGUROS UNIMED/BA). A estrutura do PDF é consistente:
//
//   1) Páginas iniciais — catálogo de entidades com documentação.
//   2) Regras (carências, coparticipação).
//   3) "QualiPRO | Tabelas de Preços" — um ou mais blocos de preços.
//      Cada bloco tem: linhas de cabeçalho (nomes dos produtos), códigos ANS,
//      metadados (Segmentação, Abrangência, Padrão de acomodação, Coparticipação),
//      e 10 linhas de preço por faixa etária.
//   4) "Área de Comercialização" — cidades.
//   5) "Rede Médica" — hospitais/labs por cidade (com marcadores PS/INT/MAT/LAB).
//
// A extração é puramente textual (via pdf-parse). Nada de OCR: os PDFs vêm com
// texto nativo.

import { PDFParse } from 'pdf-parse';

// ---------------------------------------------------------------------------
// Tipos exportados
// ---------------------------------------------------------------------------

export interface ExtractedEntity {
  /** Sigla/abreviação como aparece no PDF (ex.: "ABRABDIR"). */
  code: string;
  /** Nome completo se identificado no PDF. */
  name?: string;
}

export interface ExtractedProduct {
  /** Nome exato como aparece no cabeçalho do bloco (ex.: "Nosso Plano AHO CA MUN Apt CC"). */
  rawName: string;
  /** Código ANS (formato 123.456/78-9). */
  ansCode: string | null;
  /** "Ambulatorial" | "Ambulatorial + Hospitalar com obstetrícia" | ... */
  segment: string | null;
  /** "Municipal" | "Estadual" | "Nacional" | "Grupo de Municípios" | ... */
  coverage: string | null;
  /** "Apartamento" | "Enfermaria" | null quando não aplicável. */
  accommodation: 'Apartamento' | 'Enfermaria' | null;
  /** Preços nas 10 faixas etárias ANS (valores em R$). */
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
  /** Identificador humano do bloco (ex.: "Coparticipação Parcial", "Sem Coparticipação"). */
  blockLabel: string;
  /** Resolução de `includesCoparticipation` no Koter. */
  includesCoparticipation: 'WITH' | 'WITHOUT' | 'PARTIAL' | null;
  /** Produtos extraídos do bloco. */
  products: ExtractedProduct[];
}

export interface ExtractedCity {
  name: string;
  state?: string;
}

export interface ExtractedRefnet {
  /** Nome do estabelecimento (hospital/laboratório). */
  name: string;
  city?: string;
  /** Tipo: "HOSPITAL" | "LAB". */
  kind: 'HOSPITAL' | 'LAB' | 'UNKNOWN';
  /** Marcadores como "PS", "INT", "MAT", "LAB" (o PDF lista por linha comercial). */
  specialties?: string[];
}

export interface ExtractedPDF {
  operatorHint: string | null;
  planNameHint: string | null;
  validityBaseMonth: string | null;
  validityPeriod: string | null;
  entities: ExtractedEntity[];
  tables: ExtractedTable[];
  cities: ExtractedCity[];
  refnets: ExtractedRefnet[];
  /** Métricas pra validação. */
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

// ---------------------------------------------------------------------------
// Utilitários de texto
// ---------------------------------------------------------------------------

const AGE_GROUP_LABELS = [
  { re: /Até\s+18\s+anos/i, key: 'age0_18' as const },
  { re: /De\s+19\s+a\s+23\s+anos/i, key: 'age19_23' as const },
  { re: /De\s+24\s+a\s+28\s+anos/i, key: 'age24_28' as const },
  { re: /De\s+29\s+a\s+33\s+anos/i, key: 'age29_33' as const },
  { re: /De\s+34\s+a\s+38\s+anos/i, key: 'age34_38' as const },
  { re: /De\s+39\s+a\s+43\s+anos/i, key: 'age39_43' as const },
  { re: /De\s+44\s+a\s+48\s+anos/i, key: 'age44_48' as const },
  { re: /De\s+49\s+a\s+53\s+anos/i, key: 'age49_53' as const },
  { re: /De\s+54\s+a\s+58\s+anos/i, key: 'age54_58' as const },
  { re: /A\s+partir\s+de\s+59\s+anos/i, key: 'age59Upper' as const },
];

const ANS_CODE_RE_G = /\b(\d{3}\.\d{3}\/\d{2}-\d)\b/g;
const ANS_CODE_RE = /\b\d{3}\.\d{3}\/\d{2}-\d\b/; // não-global, seguro pra test()

function parseBrazilianNumber(s: string): number | null {
  // "1.234,56" -> 1234.56 ; "211,28" -> 211.28 ; "1.261,13" -> 1261.13
  const cleaned = s.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function stripPageMarkers(text: string): string {
  return text.replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '');
}

// Preserva tabs (que são separadores de coluna no PDF) mas remove linhas vazias.
function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \u00a0]+/g, ' ').replace(/ *\t */g, '\t'))
    .filter((l) => l.trim().length > 0);
}

// Separa uma linha em colunas usando \t como primário e múltiplos espaços como fallback.
function splitColumns(line: string): string[] {
  const byTab = line.split('\t');
  if (byTab.length > 1) return byTab.map((s) => s.trim()).filter((s) => s.length > 0);
  return line.split(/\s{2,}/).map((s) => s.trim()).filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Header: operadora + validade + linha comercial (hints)
// ---------------------------------------------------------------------------

function extractHints(text: string): Pick<
  ExtractedPDF,
  'operatorHint' | 'planNameHint' | 'validityBaseMonth' | 'validityPeriod'
> {
  const baseMatch = /Data\s+base\s+de\s+reajuste:\s*([A-Za-zçãéêíóú\/ ]+)/i.exec(text);
  const periodMatch = /Data\s+de\s+validade\s+das\s+tabelas?:\s*([A-Za-zçãéêíóú\/\d\s]+?)(?:\s{2,}|\n|Planos)/i.exec(text);

  return {
    operatorHint: null, // preenchido a partir do caller (nome da operadora vem do DB)
    planNameHint: null, // inferido depois (análise heurística dos nomes de produtos)
    validityBaseMonth: baseMatch ? baseMatch[1].trim() : null,
    validityPeriod: periodMatch ? periodMatch[1].trim() : null,
  };
}

// ---------------------------------------------------------------------------
// Bloco de tabela de preços
// ---------------------------------------------------------------------------

function sniffCoparticipation(block: string): ExtractedTable['includesCoparticipation'] {
  const lower = block.toLowerCase();
  if (/coparticipação\s*parcial/i.test(block)) return 'PARTIAL';
  if (/coparticipação\s*total/i.test(block)) return 'WITH';
  if (/planos?\s+sem\s+coparticipação/i.test(block)) return 'WITHOUT';
  if (/planos?\s+com\s+coparticipação/i.test(block)) return 'WITH';
  if (/coparticipação\s*[:：]\s*sim/i.test(block)) return 'WITH';
  if (/coparticipação\s*[:：]\s*não/i.test(block)) return 'WITHOUT';
  if (/coparticipação\s*[:：]\s*parcial/i.test(block)) return 'PARTIAL';
  if (lower.includes('com coparticipação')) return 'WITH';
  if (lower.includes('sem coparticipação')) return 'WITHOUT';
  return null;
}

function sniffBlockLabel(block: string): string {
  const first = block.split('\n').slice(0, 12).join('\n');
  const candidates = [
    /PLANOS\s*\|\s*(COPARTICIPAÇÃO\s+\w+)/i,
    /Planos\s+(SEM|COM)\s+Coparticipação/i,
    /(COM|SEM)\s+COPARTICIPAÇÃO/i,
  ];
  for (const re of candidates) {
    const m = re.exec(first);
    if (m) return m[0].trim();
  }
  return 'Tabela';
}

// Dado o texto de um bloco de preços, extrai a lista de produtos.
function parsePriceBlock(block: string): ExtractedProduct[] {
  const lines = splitLines(block);

  // Localiza a linha com os códigos ANS (formato 123.456/78-9).
  const ansLineIdx = lines.findIndex((l) => ANS_CODE_RE.test(l));
  if (ansLineIdx === -1) return [];

  // Extrai todos os códigos ANS nessa linha (podem ter múltiplos, separados por tab/espaços).
  const ansLine = lines[ansLineIdx];
  const ansCodes = [...ansLine.matchAll(ANS_CODE_RE_G)].map((m) => m[1]);

  const columnCount = ansCodes.length;
  if (columnCount === 0) return [];

  // Linhas de "nome" do produto são as logo acima da ANS. Pra lidar com quebra
  // de linha nos nomes, concatenamos tudo até o início do bloco ou até achar
  // um divisor claro (linha curta como "Planos SEM ODONTO" ou fim do bloco
  // anterior).
  const namesRaw: string[] = [];
  for (let i = ansLineIdx - 1; i >= 0; i--) {
    const l = lines[i];
    // Para quando encontra cabeçalho claro de outro bloco ou linha ANS anterior.
    if (ANS_CODE_RE.test(l)) break;
    if (/^Planos\s+(SEM|COM)/i.test(l)) break;
    if (/^PLANOS\s*\|/i.test(l)) break;
    if (/^(PLANOS|QualiPRO)$/i.test(l)) break;
    if (/^Data\s+(base|de)/i.test(l)) break;
    if (/Valores mensais expressos/i.test(l)) break;
    namesRaw.unshift(l);
    if (namesRaw.length >= 6) break;
  }

  // Reagrupa os nomes em N colunas heuristicamente: separadores de tab.
  const nameJoined = namesRaw.join(' ');
  // Abordagem: separa por 2+ espaços/tabs e tenta redistribuir em colunas.
  const nameChunks = nameJoined.split(/\s{2,}|\t+/).map((s) => s.trim()).filter(Boolean);

  // Heurística: se o número de chunks é >= columnCount, distribui os últimos N;
  // se for menor, duplica o nome base. Na maioria dos PDFs os nomes estão
  // quebrados em linhas com tab separando colunas — nameChunks costuma bater.
  const productNames: string[] = [];
  if (nameChunks.length >= columnCount) {
    // pega as últimas `columnCount` fatias como nomes
    const start = nameChunks.length - columnCount;
    for (let i = 0; i < columnCount; i++) productNames.push(nameChunks[start + i]);
  } else {
    // fallback: um nome só replicado
    const full = nameJoined.trim();
    for (let i = 0; i < columnCount; i++) productNames.push(full);
  }

  // Metadados do bloco (segmentação, abrangência, acomodação, copart).
  const blockBelow = lines.slice(ansLineIdx + 1).join('\n');
  const segment = extractFieldValues(blockBelow, /Segmentação/i, columnCount);
  const coverage = extractFieldValues(blockBelow, /Abrangência\s+geográfica/i, columnCount);
  const accommodation = extractFieldValues(blockBelow, /Padrão\s+de\s+acomodação/i, columnCount);

  // Preços por faixa etária.
  const pricesByColumn: number[][] = Array.from({ length: columnCount }, () => []);
  for (const age of AGE_GROUP_LABELS) {
    const row = findRowForLabel(blockBelow, age.re);
    if (!row) continue;
    const vals = extractNumbersFromRow(row);
    for (let i = 0; i < columnCount; i++) {
      pricesByColumn[i][ageIndex(age.key)] = vals[i] ?? 0;
    }
  }

  const products: ExtractedProduct[] = [];
  for (let i = 0; i < columnCount; i++) {
    const segI = normalizeField(segment[i]);
    const covI = normalizeField(coverage[i]);
    const accI = normalizeAccommodation(accommodation[i]);
    products.push({
      rawName: productNames[i] ?? `Coluna ${i + 1}`,
      ansCode: ansCodes[i] ?? null,
      segment: segI,
      coverage: covI,
      accommodation: accI,
      prices: {
        age0_18: pricesByColumn[i][0] ?? 0,
        age19_23: pricesByColumn[i][1] ?? 0,
        age24_28: pricesByColumn[i][2] ?? 0,
        age29_33: pricesByColumn[i][3] ?? 0,
        age34_38: pricesByColumn[i][4] ?? 0,
        age39_43: pricesByColumn[i][5] ?? 0,
        age44_48: pricesByColumn[i][6] ?? 0,
        age49_53: pricesByColumn[i][7] ?? 0,
        age54_58: pricesByColumn[i][8] ?? 0,
        age59Upper: pricesByColumn[i][9] ?? 0,
      },
    });
  }

  return products;
}

function ageIndex(k: keyof ExtractedProduct['prices']): number {
  const order: Array<keyof ExtractedProduct['prices']> = [
    'age0_18',
    'age19_23',
    'age24_28',
    'age29_33',
    'age34_38',
    'age39_43',
    'age44_48',
    'age49_53',
    'age54_58',
    'age59Upper',
  ];
  return order.indexOf(k);
}

// Localiza a linha que tem o label E valores. Labels podem ocupar 1 ou 2 linhas
// (ex.: "Padrão de acomodação\nem internação - \tColetiva \tIndividual"). A
// função tenta casar o label, e se a linha do label não tem valores, concatena
// com a próxima linha.
function findRowForLabel(block: string, re: RegExp): string | null {
  const lines = splitLines(block);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      let row = lines[i];
      // Se essa linha não tem TAB nem dígito, provavelmente só o label; junta
      // com a próxima.
      if (!row.includes('\t') && !/\d/.test(row) && lines[i + 1]) {
        row = row + ' ' + lines[i + 1];
      }
      return row;
    }
  }
  return null;
}

function extractFieldValues(block: string, labelRe: RegExp, count: number): string[] {
  const row = findRowForLabel(block, labelRe);
  if (!row) return [];
  // Remove o label. Cobre casos tipo "Segmentação", "Abrangência geográfica
  // de atendimento", "Padrão de acomodação em internação", "Coparticipação".
  const labelsToStrip = [
    labelRe,
    /^Abrangência\s+geográfica\s+de\s+atendimento/i,
    /^de\s+atendimento/i,
    /^Padrão\s+de\s+acomodação\s+em\s+internação/i,
    /^em\s+internação/i,
  ];
  let after = row;
  for (const pat of labelsToStrip) after = after.replace(pat, '').trim();
  after = after.replace(/^\s*\t+/, '').replace(/\t+/g, '\t');

  const chunks = splitColumns(after);
  if (chunks.length === 0) return [];
  if (chunks.length === 1 && count > 1) {
    // Valor único vale pra todas as colunas (ex.: "Municipal" único).
    return new Array(count).fill(chunks[0]);
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(chunks[i] ?? chunks[chunks.length - 1] ?? '');
  }
  return out;
}

function normalizeField(s: string | undefined): string | null {
  if (!s) return null;
  const t = s
    .trim()
    .replace(/\s+/g, ' ')
    // Remove superscripts unicode e dígitos soltos no fim ("Ambulatorial¹" / "Ambulatorial1").
    .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, '')
    .replace(/(\w)\s*[0-9]\b/g, '$1')
    .trim();
  if (!t) return null;
  if (/^—|^-$/.test(t)) return null;
  return t;
}

function normalizeAccommodation(raw: string | undefined): 'Apartamento' | 'Enfermaria' | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes('individual') || s.includes('apart')) return 'Apartamento';
  if (s.includes('coletiv') || s.includes('enferm')) return 'Enfermaria';
  if (s.trim() === '-' || s.trim() === '—') return null;
  return null;
}

// Extrai apenas preços (números com vírgula decimal) da linha, ignorando
// números inteiros que fazem parte da label da faixa etária.
function extractNumbersFromRow(row: string): number[] {
  const matches = row.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g) ?? [];
  return matches.map(parseBrazilianNumber).filter((n): n is number => n !== null);
}

// Divide a seção "Tabelas de Preços" em blocos, usando as linhas com ANS como âncora.
function splitPriceBlocks(pricesText: string): string[] {
  const lines = splitLines(pricesText);
  const anchors: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ANS_CODE_RE.test(lines[i])) anchors.push(i);
  }
  if (anchors.length === 0) return [];

  const blocks: string[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const start = i === 0 ? 0 : anchors[i - 1] + 1;
    const end = i === anchors.length - 1 ? lines.length : anchors[i + 1] - 1;
    blocks.push(lines.slice(start, end + 1).join('\n'));
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Cidades
// ---------------------------------------------------------------------------

function extractCities(text: string): ExtractedCity[] {
  // Seção "Área de Comercialização" — cidades vêm em listagem separada por vírgulas.
  const startIdx = text.search(/Área\s+de\s+Comercialização/i);
  if (startIdx < 0) return [];
  const tail = text.slice(startIdx);
  const endIdx = tail.search(/Rede\s+Médica|qualicorp\.com\.br\s*$|Para\s+acessar\s+a\s+rede/i);
  const section = endIdx > 0 ? tail.slice(0, endIdx) : tail;

  // Procura por linha com "municípios de:" e extrai tudo até o ponto final.
  const match = /municípios\s+de:\s*([\s\S]+?)\./i.exec(section);
  if (!match) return [];

  const list = match[1]
    .replace(/\s+/g, ' ')
    .replace(/\sE\s/gi, ', ')
    .split(/,|\s+e\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 80);

  const stateMatch = /(ALAGOAS|BAHIA|CEARÁ|DISTRITO FEDERAL|ESPÍRITO SANTO|GOIÁS|MARANHÃO|MATO GROSSO DO SUL|MATO GROSSO|MINAS GERAIS|PARÁ|PARAÍBA|PARANÁ|PERNAMBUCO|PIAUÍ|RIO DE JANEIRO|RIO GRANDE DO NORTE|RIO GRANDE DO SUL|RONDÔNIA|RORAIMA|SANTA CATARINA|SÃO PAULO|SERGIPE|TOCANTINS|AMAPÁ|AMAZONAS|ACRE)/i.exec(
    section,
  );
  const state = stateMatch ? stateMatch[1].toUpperCase() : undefined;

  return list.map((name) => ({ name, state }));
}

// ---------------------------------------------------------------------------
// Rede médica
// ---------------------------------------------------------------------------

const HOSPITAL_PREFIXES = [
  /^Hosp\./,
  /^Hospital/,
  /^Sta\.\s+C(\.|asa)/,
  /^Sta\.?\s+Casa/,
  /^Maternidade/,
  /^Mat\./,
  /^Instituto|^Inst\./,
  /^Clínica|^Clinica/,
  /^Centro\s+Médico/,
];

const LAB_HINTS = [/Lab\./, /Laboratório|Laboratorio/i, /Diagn[óo]stico/i];

function extractRefnets(text: string): ExtractedRefnet[] {
  const startIdx = text.search(/Rede\s+Médica|Rede\s+Hospitalar/i);
  if (startIdx < 0) return [];
  const section = text.slice(startIdx);

  const out: ExtractedRefnet[] = [];
  const lines = splitLines(section);

  // Ignora cabeçalhos e linhas-ruído.
  const NOISE_PATTERNS = [
    /^(CIDADE|HOSPITAIS?|LABORAT[ÓO]RIOS?|PS|INT|MAT|LAB|MAM|ESPECIAL|EXECUTIVO|CLASSIC|LIFE|COMFORT|SUPERIOR|COMPACTO|EFETIVO|COMPLETO|ESSENCIAL|UNIFÁCIL|UNIMAX|UNIPART)\b/i,
    /Rede\s+M[ée]dica/i,
    /Pronto[\s-]?Socorro|Internação|Maternidade|Laboratório/i,
    /^Informações\s+resumidas/i,
    /qualicorp\.com\.br/i,
    /^\s*\|\s*/,
    /^Cidade\s+(Hospitais|Laboratórios)/i,
    /Para\s+acessar\s+a\s+rede/i,
    /https?:\/\//i,
  ];

  let currentCity: string | undefined;
  for (const rawLine of lines) {
    const l = rawLine.replace(/\t/g, ' ').trim();
    if (!l || l.length < 4) continue;
    if (NOISE_PATTERNS.some((re) => re.test(l))) {
      // Possível linha de cidade seguido de conteúdo — pega só o primeiro token
      // se for uma cidade conhecida. Pra simplicidade, pula.
      continue;
    }

    const isHospital = HOSPITAL_PREFIXES.some((re) => re.test(l));
    const isLab = LAB_HINTS.some((re) => re.test(l));

    // Linha sem hospital/lab e curta = provável nome de cidade.
    if (!isHospital && !isLab) {
      if (l.length < 40 && /^[A-ZÀ-Ü][a-zà-ü]/.test(l)) currentCity = l;
      continue;
    }

    const specialties = [
      ...new Set(Array.from(l.matchAll(/\b(PS|INT|MAT|LAB|MAM)\b/g)).map((m) => m[1])),
    ];
    const name = l
      .replace(/\b(PS|INT|MAT|LAB|MAM)\b/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/[\t\/]+/g, ' ')
      .replace(/\s*-\s*/g, ' ')
      .trim();
    if (!name || name.length < 4) continue;

    out.push({
      name,
      city: currentCity,
      kind: isHospital ? 'HOSPITAL' : isLab ? 'LAB' : 'UNKNOWN',
      specialties: specialties.length ? specialties : undefined,
    });
  }

  // Dedupe por (name, city).
  const seen = new Set<string>();
  return out.filter((r) => {
    const key = (r.name + '|' + (r.city ?? '')).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Entidades (siglas nas páginas iniciais do PDF)
// ---------------------------------------------------------------------------

function extractEntities(text: string): ExtractedEntity[] {
  const out: ExtractedEntity[] = [];
  const seen = new Set<string>();
  // Padrão "SIGLA | Nome completo da entidade"
  const re = /^\s*([A-ZÀ-Ü][A-ZÀ-Ü0-9\-\s]{1,15})\s+\|\s+(.{5,200})$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Dedupe "ANPR ANPR" removendo repetição de palavras.
    const rawCode = m[1].trim().replace(/\s+/g, ' ');
    const parts = rawCode.split(' ');
    const uniqueParts: string[] = [];
    for (const p of parts) if (uniqueParts[uniqueParts.length - 1] !== p) uniqueParts.push(p);
    const code = uniqueParts.join(' ');
    const name = m[2].trim();
    if (seen.has(code)) continue;
    if (/^(QUALIPRO|PLANOS|TITULAR|PREÇOS?|ANS|CIDADE|HOSPITAIS?|LABORAT[ÓO]RIOS?|COPARTICIPAÇÃO|OBSTETR[ÍI]CIA)$/i.test(code)) continue;
    if (name.toLowerCase().includes('qualicorp')) continue;
    seen.add(code);
    out.push({ code, name });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

export async function parseQualicorpPdf(data: Uint8Array): Promise<ExtractedPDF> {
  const parser = new PDFParse({ data });
  let result: Awaited<ReturnType<typeof parser.getText>>;
  try {
    result = await parser.getText();
  } finally {
    await parser.destroy();
  }

  const text = stripPageMarkers(result.text);
  const pages = result.pages?.length ?? 0;

  const { validityBaseMonth, validityPeriod } = extractHints(text);

  // Isola a seção de preços, do primeiro "Tabelas de Preços" até "Área de Comercialização".
  const priceStart = text.search(/QualiPRO\s*\|\s*Tabelas?\s+de\s+Preços/i);
  const priceEnd = text.search(/Área\s+de\s+Comercialização/i);
  const pricesSection =
    priceStart >= 0 ? text.slice(priceStart, priceEnd > priceStart ? priceEnd : undefined) : '';

  // Divide em blocos e parseia cada um.
  const blocks = splitPriceBlocks(pricesSection);
  const tables: ExtractedTable[] = [];
  for (const block of blocks) {
    // Descarta "blocos fantasma": ANS que aparece em rodapé/nota sem preços.
    if (!/Até\s+18\s+anos/i.test(block)) continue;
    const products = parsePriceBlock(block);
    if (!products.length) continue;
    // Descarta se nenhum produto tem preço > 0 (sinal de rodapé).
    const hasPrices = products.some((p) => Object.values(p.prices).some((v) => v > 0));
    if (!hasPrices) continue;
    tables.push({
      blockLabel: sniffBlockLabel(block),
      includesCoparticipation: sniffCoparticipation(block),
      products,
    });
  }

  const entities = extractEntities(text);
  const cities = extractCities(text);
  const refnets = extractRefnets(text);

  const warnings: string[] = [];
  if (tables.length === 0) warnings.push('Nenhum bloco de preços identificado');
  if (cities.length === 0) warnings.push('Nenhuma cidade extraída');
  if (refnets.length === 0) warnings.push('Nenhuma refnet extraída (é possível que o PDF só remeta ao site)');

  return {
    operatorHint: null,
    planNameHint: tables[0]?.products[0]?.rawName ?? null,
    validityBaseMonth,
    validityPeriod,
    entities,
    tables,
    cities,
    refnets,
    stats: {
      pages,
      textLength: text.length,
      tableBlocks: tables.length,
      products: tables.reduce((acc, t) => acc + t.products.length, 0),
      citiesCount: cities.length,
      refnetsCount: refnets.length,
      warnings,
    },
  };
}
