// Transforma a extração raw do PDF (ExtractedPDF) no payload que o Koter
// consome em `mcp__koter_cadastro__create_table_with_products_cadastro`.
//
// A diferença principal:
//  - Chaves de preço renomeadas pro padrão Koter (priceAgeGroup018, ...).
//  - Campos implícitos injetados (contractType=NOT_APPLICABLE pra Adesão).
//  - Heurística pra tirar a "linha comercial" (table.name) do rawName.
//  - Nomes dos metadados (segment/coverage/accommodation) mantidos como
//    strings: a resolução para IDs do Koter acontece no momento do cadastro,
//    via MCP `get_metadata_ids`. O adapter entrega todos os nomes necessários.
//  - Associações viram lista de nomes (o Koter mapeia via
//    `fetch_associations_cadastro` na hora do cadastro).

import type { ExtractedPDF, ExtractedProduct } from './pdf-parser.js';

export interface KoterContext {
  operatorName: string;
  uf: string;
  /** Categoria do plano. Todas as Tabelas de Venda QualiVendas são Adesão. */
  category: 'ADHESION' | 'PME' | 'PF';
  /** Entity name desta tabela (vem do cadastro da Qualicorp — ex.: ABRABDIR). */
  entityName?: string;
  /** URL do PDF original, apenas como metadado. */
  pdfUrl?: string;
}

export interface KoterProduct {
  name: string;
  /** "Apartamento" / "Enfermaria" / null quando Ambulatorial puro. */
  accommodationName: 'Apartamento' | 'Enfermaria' | null;
  coverageName: string | null;
  segmentName: string | null;
  ansCode: string | null;
  priceAgeGroup018: number;
  priceAgeGroup1923: number;
  priceAgeGroup2428: number;
  priceAgeGroup2933: number;
  priceAgeGroup3438: number;
  priceAgeGroup3943: number;
  priceAgeGroup4448: number;
  priceAgeGroup4953: number;
  priceAgeGroup5458: number;
  priceAgeGroup59Upper: number;
  cities: Array<{ state?: string; name: string }>;
  refnets: Array<{ name: string; city?: string; specialties?: string[] }>;
}

export interface KoterTable {
  name: string;
  /** Rótulo interno preservado (ex.: "PLANOS | COPARTICIPAÇÃO PARCIAL (SEM ODONTO)"). */
  sourceLabel: string;
  /** WITH / WITHOUT / PARTIAL conforme enum do Koter. */
  includesCoparticipation: 'WITH' | 'WITHOUT' | 'PARTIAL' | null;
  contractType: 'COMPULSORY' | 'VOLUNTARY' | 'NOT_APPLICABLE';
  /** PF/Adesão: null.  PME: valores definidos (MEI/PME/Empresarial). */
  lpts: string[];
  /** Adesão: nomes das entidades aceitas.  Resolve pra IDs no cadastro. */
  associations: string[];
  /** Faixa de vidas. Adesão costuma ser null. */
  minCoveredLives: number | null;
  maxCoveredLives: number | null;
  includesIOF: boolean;
  isRefundable: boolean;
  /** Indica se o parser inferiu (heurística) em vez de extrair explicitamente. */
  inferred: {
    name: boolean;
    includesCoparticipation: boolean;
    contractType: boolean;
  };
  products: KoterProduct[];
}

export interface KoterPlanPayload {
  /** Preenchido pelo usuário ao cadastrar — URL/ID do plano no Koter. */
  planId: string | null;
  category: KoterContext['category'];
  operatorName: string;
  uf: string;
  pdfUrl: string | null;
  /** Nome do plano inferido ("linha comercial" do PDF). */
  planName: string | null;
  validity: {
    baseMonth: string | null;
    period: string | null;
  };
  tables: KoterTable[];
  /** Metadados que o usuário/cadastrador precisa resolver antes de subir. */
  lookupsPending: {
    associationsByName: string[];
    accommodationsByName: string[];
    coveragesByName: string[];
    segmentsByName: string[];
    citiesByName: Array<{ state?: string; name: string }>;
  };
}

// ---------------------------------------------------------------------------
// Heurística da linha comercial (table.name)
// ---------------------------------------------------------------------------

// Tokens/palavras que começam a parte TÉCNICA do nome do produto (segmento,
// acomodação, abrangência, siglas de código). Tudo a partir daí é descartado
// ao tentar extrair o "nome comercial" da linha.
const CUT_MARKERS = [
  /\bAdesão\b/i,
  /\bAdesao\b/i,
  /\bCom\s+Patrocinador\b/i,
  /\bTrad\.?\s*\d/i,
  /\bAHO\b/i,
  /\bA\+H\b/i,
  /\bF\s+Especial\b/i,
  /\bF\s+Executivo\b/i,
  /\bCC\s+QC\b/i,
  /\bQC\s+COP\b/i,
  /\bCA\s+MUN\b/i,
  /\bCOP\s+(RM|RC|R\d)\b/i,
  /\bEnfermaria\b/i,
  /\bApartamento\b/i,
  /\b(Enf|Apto|Apt|Copart|Coparticipação|Coparticipacao)\b/i,
  // Token técnico isolado: 1-2 letras maiúsculas (A, AHO, BA, CE, NP, MG...)
  // Se for o primeiro token, não corta. Se vier DEPOIS de palavras, corta.
  /(?<=\w\s)\b[A-Z]{1,3}\b(?!\s+[a-z])/,
  /\b[A-Z]{2,}\s+[A-Z]{2,}\b/, // sequência de siglas (CA MUN, BA CA, etc.)
  /\b\d+\b/, // qualquer número
];

// Pedaços de texto que nunca fazem parte do nome comercial — quando o bloco
// começa com nota de rodapé ou header do PDF, a gente descarta e tenta o
// próximo produto.
const JUNK_PREFIXES = [
  /^\*/,
  /^\s*\*/,
  /^QualiPRO/i,
  /^Tabelas?\s+de/i,
  /^PLANOS\b/,
  /^Coparticipação/i,
  /^Data\s+(base|de)/i,
  /^Valores\s+mensais/i,
  /^Saúde\s+por/i,
  /^qualicorp\b/i,
];

// Sufixos sem valor semântico no nome comercial — cortamos quando aparecem no fim.
const TRAILING_NOISE = [
  /\s+(BA|SP|RJ|MG|CE|AL|AM|AP|PB|PE|PI|PR|RS|SC|SE|TO|RN|RO|RR|GO|DF|MA|MT|MS|BA|PA|ES)\s*$/, // UF no fim
  /\s+[A-Z]{1,3}\s*$/, // sigla curta no fim (A, CA, MUN)
  /\s+(por|de|com|em|para|pra|da|do|a|o)\s*$/i, // preposição solta no fim ("Saúde por")
];

function isJunk(raw: string): boolean {
  return JUNK_PREFIXES.some((re) => re.test(raw));
}

function extractCommercialPrefix(raw: string): string {
  if (!raw) return '';
  let cut = raw.length;
  for (const re of CUT_MARKERS) {
    const m = re.exec(raw);
    if (m && m.index < cut) cut = m.index;
  }
  let pfx = raw.slice(0, cut).trim().replace(/\s+/g, ' ');
  // Remove ruído do fim.
  for (const re of TRAILING_NOISE) pfx = pfx.replace(re, '').trim();
  // Limita a 4 palavras significativas.
  const tokens = pfx.split(' ').filter(Boolean);
  return tokens.slice(0, 4).join(' ');
}

/**
 * Infere o nome da linha comercial a partir dos rawNames dos produtos.
 * Filtra produtos cujo rawName é lixo (rodapé, header de PDF) e pega o
 * prefixo comum entre os restantes.
 */
export function guessTableName(products: ExtractedProduct[]): string {
  if (products.length === 0) return 'Tabela';

  // Filtra produtos onde o rawName claramente começa com lixo.
  const clean = products.filter((p) => p.rawName && !isJunk(p.rawName));
  const source = clean.length > 0 ? clean : products;

  const prefixes = source.map((p) => extractCommercialPrefix(p.rawName)).filter(Boolean);
  const common = longestCommonPrefix(prefixes);
  const trimmed = common.trim().replace(/\s+/g, ' ');
  if (trimmed.length >= 3) return trimmed;

  // Fallback 1: prefixo do primeiro produto limpo.
  if (prefixes[0]) return prefixes[0];

  // Fallback 2: primeiras 2 palavras do rawName do primeiro produto limpo.
  const first = source[0].rawName ?? '';
  const firstTokens = first.trim().split(' ').slice(0, 2).join(' ');
  return firstTokens || 'Tabela';
}

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (prefix && !strings[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
    if (!prefix) return '';
  }
  return prefix;
}

// ---------------------------------------------------------------------------
// Heurística do nome do produto
// ---------------------------------------------------------------------------

/** Gera um nome legível pro produto, baseado em segment + coverage + accommodation. */
export function deriveProductName(p: ExtractedProduct): string {
  const parts: string[] = [];
  if (p.accommodation) parts.push(p.accommodation);
  if (p.coverage) parts.push(p.coverage);
  if (p.segment) {
    // Encurta "Ambulatorial + Hospitalar com obstetrícia" -> "Amb+Hosp+Obst"
    const short = p.segment
      .replace(/Ambulatorial/gi, 'Amb')
      .replace(/Hospitalar/gi, 'Hosp')
      .replace(/com\s+obstetr[íi]cia/gi, '+Obst')
      .replace(/sem\s+obstetr[íi]cia/gi, '')
      .replace(/\s*\+\s*/g, '+')
      .replace(/\s+/g, ' ')
      .trim();
    parts.push(short);
  }
  return parts.join(' ') || p.rawName || 'Produto';
}

// ---------------------------------------------------------------------------
// Transformação principal
// ---------------------------------------------------------------------------

export function toKoterPayload(
  extraction: ExtractedPDF,
  ctx: KoterContext,
): KoterPlanPayload {
  const planName = inferPlanName(extraction);

  const tables: KoterTable[] = extraction.tables.map((t) => {
    const name = guessTableName(t.products);
    const products: KoterProduct[] = t.products.map((p) => ({
      name: deriveProductName(p),
      accommodationName: p.accommodation,
      coverageName: p.coverage,
      segmentName: p.segment,
      ansCode: p.ansCode,
      priceAgeGroup018: p.prices.age0_18,
      priceAgeGroup1923: p.prices.age19_23,
      priceAgeGroup2428: p.prices.age24_28,
      priceAgeGroup2933: p.prices.age29_33,
      priceAgeGroup3438: p.prices.age34_38,
      priceAgeGroup3943: p.prices.age39_43,
      priceAgeGroup4448: p.prices.age44_48,
      priceAgeGroup4953: p.prices.age49_53,
      priceAgeGroup5458: p.prices.age54_58,
      priceAgeGroup59Upper: p.prices.age59Upper,
      cities: extraction.cities.map((c) => ({ name: c.name, state: c.state })),
      refnets: extraction.refnets.map((r) => ({
        name: r.name,
        city: r.city,
        specialties: r.specialties,
      })),
    }));

    const contractType = ctx.category === 'ADHESION' ? 'NOT_APPLICABLE' : 'COMPULSORY';

    return {
      name,
      sourceLabel: t.blockLabel,
      includesCoparticipation: t.includesCoparticipation,
      contractType,
      lpts: [],
      associations:
        ctx.category === 'ADHESION' ? extraction.entities.map((e) => e.code) : [],
      minCoveredLives: null,
      maxCoveredLives: null,
      includesIOF: false,
      isRefundable: false,
      inferred: {
        name: true, // nome da tabela é sempre heurístico
        includesCoparticipation: t.copartInferred,
        contractType: true, // implícito pela categoria
      },
      products,
    };
  });

  return {
    planId: null,
    category: ctx.category,
    operatorName: ctx.operatorName,
    uf: ctx.uf,
    pdfUrl: ctx.pdfUrl ?? null,
    planName,
    validity: {
      baseMonth: extraction.validityBaseMonth,
      period: extraction.validityPeriod,
    },
    tables,
    lookupsPending: {
      associationsByName: ctx.category === 'ADHESION' ? extraction.entities.map((e) => e.code) : [],
      accommodationsByName: unique(
        extraction.tables.flatMap((t) => t.products.map((p) => p.accommodation).filter(Boolean)),
      ) as string[],
      coveragesByName: unique(
        extraction.tables.flatMap((t) => t.products.map((p) => p.coverage).filter(Boolean)),
      ) as string[],
      segmentsByName: unique(
        extraction.tables.flatMap((t) => t.products.map((p) => p.segment).filter(Boolean)),
      ) as string[],
      citiesByName: extraction.cities.map((c) => ({ state: c.state, name: c.name })),
    },
  };
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function inferPlanName(extraction: ExtractedPDF): string | null {
  // Tenta inferir a partir da linha comercial comum entre todas as tabelas.
  const allProducts = extraction.tables.flatMap((t) => t.products);
  if (allProducts.length === 0) return null;
  const name = guessTableName(allProducts);
  return name && name !== 'Tabela' ? name : null;
}
