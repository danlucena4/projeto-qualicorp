import fs from 'node:fs';
import path from 'node:path';
import {
  chromium,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from 'playwright';
import { config } from '../config.js';
import {
  listStates,
  markStateSynced,
  upsertOperator,
  linkOperatorToState,
  upsertProfession,
  linkProfessionToState,
  upsertEntity,
  linkEntityToState,
  upsertQcTable,
} from '../db/index.js';
import { syncBus } from './events.js';
import { waitForMfaCode } from './session.js';

interface RunContext {
  runId: number;
  signal: AbortSignal;
}

const API_BASE = 'https://apigateway.qualicorp.com.br/tamojunto/tabelas-venda';

// ---------------------------------------------------------------------------
// Helpers de log/progresso
// ---------------------------------------------------------------------------

function log(runId: number, message: string, level: 'info' | 'warn' | 'error' = 'info') {
  syncBus.emitEvent({ type: 'log', runId, message, level });
}
function progress(runId: number, step: string, pct?: number, message?: string) {
  syncBus.emitEvent({ type: 'progress', runId, step, pct, message });
}

// ---------------------------------------------------------------------------
// Browser + sessão
// ---------------------------------------------------------------------------

async function ensureStorageDir() {
  const dir = path.dirname(config.playwright.storagePath);
  fs.mkdirSync(dir, { recursive: true });
}

async function openContext(): Promise<BrowserContext> {
  const browser = await chromium.launch({
    headless: !config.playwright.headed,
    channel: config.playwright.channel,
  });
  const hasState = fs.existsSync(config.playwright.storagePath);
  return browser.newContext(
    hasState ? { storageState: config.playwright.storagePath } : {},
  );
}

async function saveStorage(ctx: BrowserContext) {
  await ensureStorageDir();
  await ctx.storageState({ path: config.playwright.storagePath });
}

async function isLoggedIn(page: Page): Promise<boolean> {
  return !page.url().includes('/login');
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function performLogin(page: Page, ctx: RunContext) {
  const { runId } = ctx;
  progress(runId, 'login', 5, 'Abrindo portal Qualicorp');

  await page.goto(config.qualicorp.url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  if (await isLoggedIn(page)) {
    log(runId, 'Sessão ativa reaproveitada — sem login');
    return;
  }

  const userSel =
    'input[name="username"], input[name="email"], input[type="email"], input[formcontrolname="username"], input[formcontrolname="email"], input[type="text"]';
  const passSel =
    'input[name="password"], input[type="password"], input[formcontrolname="password"]';

  await page.waitForSelector(userSel, { timeout: 20_000 });
  await page.fill(userSel, config.qualicorp.user);
  await page.fill(passSel, config.qualicorp.password);
  log(runId, 'Credenciais preenchidas, enviando formulário');

  await page
    .locator(
      'button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar")',
    )
    .first()
    .click();

  await page.waitForTimeout(3000);

  const mfaSel =
    'input[name="code"], input[name="mfa"], input[name="token"], input[autocomplete="one-time-code"], input[maxlength="6"], input[maxlength="4"]';
  const needsMfa = await page.$(mfaSel);

  if (needsMfa) {
    progress(runId, 'mfa', 10, 'Código MFA solicitado');
    syncBus.emitEvent({
      type: 'mfa_required',
      runId,
      reason: 'Código enviado por e-mail pela Qualicorp',
    });
    const code = await waitForMfaCode(runId);
    syncBus.emitEvent({ type: 'mfa_received', runId });
    await needsMfa.fill(code);
    await page
      .locator(
        'button[type="submit"], button:has-text("Validar"), button:has-text("Confirmar")',
      )
      .first()
      .click();
    await page.waitForTimeout(4000);
  }

  await page
    .waitForURL((u) => !u.toString().includes('/login'), { timeout: 60_000 })
    .catch(() => {});
  if (!(await isLoggedIn(page))) {
    throw new Error('Login falhou: ainda na tela de login');
  }
  progress(runId, 'login', 15, 'Login concluído');
}

// ---------------------------------------------------------------------------
// Captura de headers de auth
// ---------------------------------------------------------------------------

interface AuthHeaders {
  auth: string;
  'X-Gravitee-Api-Key': string;
  [k: string]: string;
}

async function captureAuthHeaders(page: Page, runId: number): Promise<AuthHeaders> {
  // Navega pra tela de Tabelas de Venda. Ao aparecer, o front dispara
  // automaticamente GETs para /operadoras/{UF} (com os headers que queremos).
  progress(runId, 'auth', 20, 'Capturando headers de autenticação');

  const box: { value: AuthHeaders | null } = { value: null };
  const listener = (req: import('playwright').Request) => {
    if (box.value) return;
    const url = req.url();
    if (url.includes('apigateway.qualicorp.com.br/tamojunto/tabelas-venda/')) {
      const h = req.headers();
      if (h['auth'] && h['x-gravitee-api-key']) {
        box.value = {
          auth: h['auth'],
          'X-Gravitee-Api-Key': h['x-gravitee-api-key'],
        };
      }
    }
  };
  page.on('request', listener);

  try {
    await page.goto('https://qualivendas.qualicorp.com.br/#/tabelas-venda', {
      waitUntil: 'domcontentloaded',
    });
    // Espera até 20s pelos headers.
    const deadline = Date.now() + 20_000;
    while (!box.value && Date.now() < deadline) {
      await page.waitForTimeout(500);
    }
  } finally {
    page.off('request', listener);
  }

  const captured = box.value;
  if (!captured) {
    throw new Error('Não consegui capturar headers de auth na tela de Tabelas de Venda');
  }
  log(runId, `Headers capturados (auth.len=${captured.auth.length})`);
  return captured;
}

// ---------------------------------------------------------------------------
// Cliente API (via APIRequestContext do Playwright, reaproveitando cookies)
// ---------------------------------------------------------------------------

async function apiGet<T>(
  api: APIRequestContext,
  url: string,
  headers: AuthHeaders,
): Promise<T> {
  const r = await api.get(url, { headers });
  if (!r.ok()) {
    const body = await r.text().catch(() => '');
    throw new Error(`GET ${url} → ${r.status()} ${body.slice(0, 200)}`);
  }
  const json = (await r.json()) as { status?: number; message?: string; data?: T };
  if (!json || (json.status && json.status !== 200)) {
    throw new Error(`GET ${url} → payload inesperado: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Extração por UF
// ---------------------------------------------------------------------------

interface QcTableRow {
  entidade: string;
  logoOperadora?: string;
  linkTabela?: string;
  linkAdesao?: string;
  linkFiliacao?: string;
  linkAditivo?: string;
  linkOutrosDocumentos?: string;
  publico?: number;
  [k: string]: unknown;
}

function deriveOperatorName(logoUrl: string | undefined, rawName?: string): string {
  if (rawName) return rawName;
  if (!logoUrl) return 'UNKNOWN';
  const file = logoUrl.split('/').pop() ?? '';
  // Logo_Hapvida.png -> Hapvida; Logo_SulAmericaSaudeHospitalar.png -> Sul America...
  return file
    .replace(/\.(png|jpg|jpeg|svg|webp)$/i, '')
    .replace(/^(Logo|logo)_?/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toUpperCase()
    .trim() || 'UNKNOWN';
}

async function extractForState(
  api: APIRequestContext,
  headers: AuthHeaders,
  uf: string,
  runId: number,
): Promise<{ operators: number; entities: number; professions: number; tables: number }> {
  log(runId, `[${uf}] extraindo operadoras/profissões/entidades/tabelas`);

  // 1) Operadoras do estado
  const operators = await apiGet<Array<{ nome: string }>>(
    api,
    `${API_BASE}/operadoras/${uf}`,
    headers,
  );
  const operatorIds: Record<string, number> = {};
  for (const op of operators) {
    const id = upsertOperator(op.nome, null);
    linkOperatorToState(uf, id);
    operatorIds[op.nome] = id;
  }

  if (operators.length === 0) {
    log(runId, `[${uf}] sem operadoras — pulando`);
    markStateSynced(uf);
    return { operators: 0, entities: 0, professions: 0, tables: 0 };
  }

  const allOps = operators.map((o) => o.nome).join(',');

  // 2) Profissões e entidades (dependem da lista de operadoras)
  const profissoes = await apiGet<Array<{ nome: string }>>(
    api,
    `${API_BASE}/profissoes/${uf}?operadoras=${encodeURIComponent(allOps)}`,
    headers,
  );
  for (const p of profissoes) {
    const id = upsertProfession(p.nome);
    linkProfessionToState(uf, id);
  }

  const entidades = await apiGet<Array<{ nome: string }>>(
    api,
    `${API_BASE}/entidades/${uf}?operadoras=${encodeURIComponent(allOps)}`,
    headers,
  );
  for (const e of entidades) {
    const id = upsertEntity(e.nome, null);
    linkEntityToState(uf, id);
  }

  // 3) Tabelas (endpoint principal)
  const rows = await apiGet<QcTableRow[]>(
    api,
    `${API_BASE}/${uf}?operadoras=${encodeURIComponent(allOps)}`,
    headers,
  );

  let tablesInserted = 0;
  for (const row of rows) {
    const opName = deriveOperatorName(row.logoOperadora as string | undefined);
    // Se a dedução não bater com nenhuma operadora conhecida, faz fuzzy: tenta
    // casar pelo nome da operadora no endpoint /operadoras — a heurística é
    // "contém o mesmo prefixo". Se falhar, cria um novo registro pelo nome
    // derivado (melhor manter o dado do que perder).
    let operatorId = operatorIds[opName];
    if (!operatorId) {
      const match = Object.keys(operatorIds).find(
        (k) => k.toUpperCase().startsWith(opName.split(' ')[0]),
      );
      operatorId = match ? operatorIds[match] : upsertOperator(opName, row.logoOperadora ?? null);
    } else if (row.logoOperadora) {
      // Atualiza logo se não tinha.
      upsertOperator(opName, row.logoOperadora);
    }

    const entityId = upsertEntity(row.entidade, row.linkFiliacao ?? null);
    linkEntityToState(uf, entityId);
    linkOperatorToState(uf, operatorId);

    upsertQcTable({
      uf,
      operatorId,
      entityId,
      linkTabela: row.linkTabela ?? null,
      linkAdesao: row.linkAdesao ?? null,
      linkFiliacao: row.linkFiliacao ?? null,
      linkAditivo: row.linkAditivo ?? null,
      linkOutrosDocumentos: row.linkOutrosDocumentos ?? null,
      publico: typeof row.publico === 'number' ? row.publico : null,
      rawJson: row,
    });
    tablesInserted++;
  }

  markStateSynced(uf);
  log(
    runId,
    `[${uf}] ok: ${operators.length} operadoras, ${entidades.length} entidades, ${profissoes.length} profissões, ${tablesInserted} tabelas`,
  );
  return {
    operators: operators.length,
    entities: entidades.length,
    professions: profissoes.length,
    tables: tablesInserted,
  };
}

// ---------------------------------------------------------------------------
// Run principal
// ---------------------------------------------------------------------------

export async function runQualicorpSync(ctx: RunContext) {
  const { runId } = ctx;
  progress(runId, 'start', 0, 'Iniciando sync Qualicorp');

  const context = await openContext();
  const totals = { operators: 0, entities: 0, professions: 0, tables: 0, states: 0 };
  try {
    const page = await context.newPage();
    await performLogin(page, ctx);
    await saveStorage(context);

    const headers = await captureAuthHeaders(page, runId);

    // A partir daqui não precisamos mais da page — chamamos a API via
    // APIRequestContext do Playwright, que reaproveita cookies da sessão.
    const api = context.request;

    const states = listStates();
    const total = states.length;
    progress(runId, 'extract', 25, `Extraindo ${total} estados`);

    for (let i = 0; i < states.length; i++) {
      if (ctx.signal.aborted) throw new Error('Sync cancelada pelo usuário');
      const s = states[i];
      try {
        const r = await extractForState(api, headers, s.uf, runId);
        totals.operators += r.operators;
        totals.entities += r.entities;
        totals.professions += r.professions;
        totals.tables += r.tables;
        totals.states++;
      } catch (err) {
        log(runId, `[${s.uf}] falhou: ${(err as Error).message}`, 'error');
      }
      const pct = 25 + Math.floor(((i + 1) / total) * 70);
      progress(runId, 'extract', pct, `${s.uf}: ${totals.tables} tabelas no total`);
    }

    progress(runId, 'done', 100, 'Sync finalizada');
    return totals;
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}
