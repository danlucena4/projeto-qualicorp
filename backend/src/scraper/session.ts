// Estado compartilhado do scraper em execução. Mantém uma única run ativa
// por vez + um canal pra receber o código MFA do frontend.

type MfaResolver = (code: string) => void;

interface ActiveRun {
  runId: number;
  abort: AbortController;
  mfaResolver: MfaResolver | null;
}

let active: ActiveRun | null = null;

export function getActiveRun(): ActiveRun | null {
  return active;
}

export function setActiveRun(run: ActiveRun | null) {
  active = run;
}

export function waitForMfaCode(runId: number, timeoutMs = 5 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!active || active.runId !== runId) {
      reject(new Error('No active run'));
      return;
    }
    const timer = setTimeout(() => {
      if (active && active.runId === runId) active.mfaResolver = null;
      reject(new Error('MFA code timeout'));
    }, timeoutMs);

    active.mfaResolver = (code: string) => {
      clearTimeout(timer);
      resolve(code);
    };
  });
}

export function submitMfaCode(runId: number, code: string): boolean {
  if (!active || active.runId !== runId || !active.mfaResolver) return false;
  const resolver = active.mfaResolver;
  active.mfaResolver = null;
  resolver(code);
  return true;
}
