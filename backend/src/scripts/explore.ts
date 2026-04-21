// Script de exploração manual do portal Qualicorp.
// Abre o browser headed, loga, espera você colocar o código MFA num arquivo
// (se o portal pedir), e depois dumpa HTML + screenshots das páginas principais
// pra eu analisar e mapear a extração.
//
// Rodar: npx tsx src/scripts/explore.ts
// Para dar o código MFA: escreva o código em `explore-output/.mfa-code`

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { config } from '../config.js';

const OUT_DIR = path.resolve(process.cwd(), 'explore-output');
const MFA_FILE = path.join(OUT_DIR, '.mfa-code');
const MFA_FLAG = path.join(OUT_DIR, 'WAITING_FOR_MFA.txt');
const DONE_FLAG = path.join(OUT_DIR, 'DONE.txt');

fs.mkdirSync(OUT_DIR, { recursive: true });
// Limpa flags antigas.
[MFA_FILE, MFA_FLAG, DONE_FLAG].forEach((f) => {
  try {
    fs.unlinkSync(f);
  } catch {}
});

async function dump(page: Page, label: string) {
  const safe = label.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
  const htmlPath = path.join(OUT_DIR, `${safe}.html`);
  const pngPath = path.join(OUT_DIR, `${safe}.png`);
  const urlPath = path.join(OUT_DIR, `${safe}.url.txt`);

  const html = await page.content();
  fs.writeFileSync(htmlPath, html, 'utf-8');
  await page.screenshot({ path: pngPath, fullPage: true });
  fs.writeFileSync(urlPath, page.url(), 'utf-8');
  console.log(`[dump] ${label} (${page.url()})`);
}

async function dumpInteractive(page: Page, label: string) {
  const safe = label.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
  const jsonPath = path.join(OUT_DIR, `${safe}.interactive.json`);
  const items = await page.evaluate(() => {
    const SELECTORS =
      'a, button, input, select, textarea, [role=button], [role=link], [role=tab], [role=menuitem]';
    const nodes = Array.from(document.querySelectorAll(SELECTORS));
    return nodes.slice(0, 400).map((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        id: (el as HTMLElement).id || null,
        name: (el as HTMLInputElement).name || null,
        type: (el as HTMLInputElement).type || null,
        role: el.getAttribute('role'),
        text: (el.textContent ?? '').trim().slice(0, 140),
        href: (el as HTMLAnchorElement).href || null,
        placeholder: (el as HTMLInputElement).placeholder || null,
        ariaLabel: el.getAttribute('aria-label'),
        classes: (el as HTMLElement).className?.toString?.()?.slice(0, 200) || null,
        visible: rect.width > 0 && rect.height > 0,
      };
    });
  });
  fs.writeFileSync(jsonPath, JSON.stringify(items, null, 2), 'utf-8');
}

async function dumpMeta(page: Page, label: string) {
  const safe = label.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
  const nav = await page.evaluate(() => {
    const pick = (sel: string) =>
      Array.from(document.querySelectorAll(sel))
        .map((el) => ({
          text: (el.textContent ?? '').trim().slice(0, 80),
          href: (el as HTMLAnchorElement).href || null,
        }))
        .filter((x) => x.text);
    return {
      navLinks: pick('nav a, aside a, [role=navigation] a'),
      topBarButtons: pick('header button, [role=banner] button'),
      menuItems: pick('[role=menuitem], [role=menu] a'),
      headings: Array.from(document.querySelectorAll('h1, h2, h3')).map((h) =>
        (h.textContent ?? '').trim().slice(0, 120),
      ),
      tableHeaders: Array.from(document.querySelectorAll('th')).map((th) =>
        (th.textContent ?? '').trim().slice(0, 80),
      ),
      currentUrl: window.location.href,
      title: document.title,
    };
  });
  fs.writeFileSync(
    path.join(OUT_DIR, `${safe}.meta.json`),
    JSON.stringify(nav, null, 2),
    'utf-8',
  );
}

async function waitForMfaFile(timeoutMs = 5 * 60_000): Promise<string> {
  fs.writeFileSync(
    MFA_FLAG,
    [
      'O portal pediu um código MFA.',
      '',
      'Assim que chegar o código por e-mail, escreva o código dentro do arquivo:',
      '  ' + MFA_FILE,
      '',
      '(ou seja: cole o código no arquivo `.mfa-code` e salve. O script vai continuar sozinho.)',
    ].join('\n'),
    'utf-8',
  );
  console.log('[explore] aguardando código MFA em', MFA_FILE);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(MFA_FILE)) {
      const code = fs.readFileSync(MFA_FILE, 'utf-8').trim();
      if (code) {
        fs.unlinkSync(MFA_FILE);
        try {
          fs.unlinkSync(MFA_FLAG);
        } catch {}
        return code;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Timeout aguardando código MFA');
}

async function tryClickByText(page: Page, texts: string[]) {
  for (const t of texts) {
    const loc = page.locator(`text=${t}`).first();
    if (await loc.count()) {
      try {
        await loc.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        return t;
      } catch {}
    }
  }
  return null;
}

(async () => {
  console.log('[explore] abrindo Chromium (headed)...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('[explore] navegando para login...');
  await page.goto(config.qualicorp.url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await dump(page, '01_login_page');
  await dumpInteractive(page, '01_login_page');

  const userSel =
    'input[name="username"], input[name="email"], input[type="email"], input[formcontrolname="username"], input[formcontrolname="email"]';
  const passSel =
    'input[name="password"], input[type="password"], input[formcontrolname="password"]';

  await page.waitForSelector(userSel, { timeout: 20_000 });
  await page.fill(userSel, config.qualicorp.user);
  await page.fill(passSel, config.qualicorp.password);
  console.log('[explore] credenciais preenchidas');

  const submitBtn = page
    .locator(
      'button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar"), button:has-text("Login")',
    )
    .first();
  await submitBtn.click();
  console.log('[explore] formulário enviado');
  await page.waitForTimeout(3500);
  await dump(page, '02_post_submit');
  await dumpInteractive(page, '02_post_submit');

  const mfaSel =
    'input[name="code"], input[name="mfa"], input[name="token"], input[autocomplete="one-time-code"], input[maxlength="6"], input[maxlength="4"]';
  const needsMfa = await page.$(mfaSel);

  if (needsMfa) {
    const code = await waitForMfaFile();
    await needsMfa.fill(code);
    await page
      .locator(
        'button[type="submit"], button:has-text("Validar"), button:has-text("Confirmar"), button:has-text("Enviar")',
      )
      .first()
      .click();
    await page.waitForTimeout(4000);
  }

  await page
    .waitForURL((u) => !u.toString().includes('/login'), { timeout: 60_000 })
    .catch(() => {
      console.log('[explore] WARNING: ainda em /login — prosseguindo mesmo assim');
    });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);

  await dump(page, '03_dashboard');
  await dumpInteractive(page, '03_dashboard');
  await dumpMeta(page, '03_dashboard');

  // Tenta clicar em seções comuns de um portal de planos/vendas.
  const candidates = [
    'Planos',
    'Produtos',
    'Operadoras',
    'Tabelas',
    'Cotar',
    'Cotação',
    'Vendas',
    'Catálogo',
    'Administradora',
    'Adesão',
    'PME',
    'PF',
    'Pessoa Física',
  ];

  for (let i = 0; i < candidates.length; i++) {
    const label = candidates[i];
    const clicked = await tryClickByText(page, [label]);
    if (clicked) {
      const name = `04_nav_${String(i + 1).padStart(2, '0')}_${clicked}`;
      await dump(page, name);
      await dumpMeta(page, name);
      // volta pro dashboard se possível, senão continua
      await page.goBack().catch(() => {});
      await page.waitForTimeout(1500);
    }
  }

  fs.writeFileSync(DONE_FLAG, new Date().toISOString(), 'utf-8');
  console.log('[explore] concluído. Arquivos em:', OUT_DIR);
  console.log('[explore] fechando browser em 10s (você pode interromper com Ctrl+C)...');
  await page.waitForTimeout(10_000);
  await browser.close();
})().catch((err) => {
  console.error('[explore] erro:', err);
  fs.writeFileSync(
    path.join(OUT_DIR, 'ERROR.txt'),
    String((err as Error).stack ?? err),
    'utf-8',
  );
  process.exit(1);
});
