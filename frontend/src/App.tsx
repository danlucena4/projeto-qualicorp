import { useEffect, useRef, useState } from 'react';
import { api } from './api/client';
import { MfaModal } from './components/MfaModal';
import { ProgressLog, type LogLine } from './components/ProgressLog';
import { DataExplorer } from './components/DataExplorer';

type Status = 'IDLE' | 'RUNNING' | 'WAITING_MFA' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export function App() {
  const [runId, setRunId] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>('IDLE');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [progressPct, setProgressPct] = useState<number | undefined>(undefined);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [mfaReason, setMfaReason] = useState<string | undefined>(undefined);
  const [dataKey, setDataKey] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  function appendLine(kind: LogLine['kind'], text: string) {
    setLines((prev) => [...prev, { ts: Date.now(), kind, text }]);
  }

  function closeStream() {
    esRef.current?.close();
    esRef.current = null;
  }

  useEffect(() => () => closeStream(), []);

  async function startSync() {
    setLines([]);
    setProgressPct(undefined);
    setStatus('RUNNING');
    try {
      const { runId } = await api.startSync();
      setRunId(runId);
      attachStream(runId);
    } catch (err) {
      setStatus('FAILED');
      appendLine('error', `Falha ao iniciar sync: ${(err as Error).message}`);
    }
  }

  function attachStream(id: number) {
    closeStream();
    const es = api.streamSync(id);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        handleEvent(data);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      // EventSource reconecta automaticamente; só fechamos quando o run termina.
    };
  }

  function handleEvent(data: any) {
    const event = data.type === 'history' ? data.event : data;
    const t = event.type ?? event.kind;
    switch (t) {
      case 'log':
        appendLine(
          event.level === 'error' ? 'error' : event.level === 'warn' ? 'warn' : 'log',
          event.message ?? '',
        );
        break;
      case 'progress': {
        const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
        const pct = event.pct ?? payload?.pct;
        const msg = event.message ?? payload?.message ?? event.step ?? payload?.step ?? '';
        if (typeof pct === 'number') setProgressPct(pct);
        appendLine('progress', `▸ ${msg}${typeof pct === 'number' ? ` (${pct}%)` : ''}`);
        break;
      }
      case 'mfa_required': {
        const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
        setStatus('WAITING_MFA');
        setMfaReason(event.reason ?? payload?.reason);
        setMfaOpen(true);
        appendLine('mfa', 'Código MFA solicitado. Informe o código recebido por e-mail.');
        break;
      }
      case 'mfa_received':
        setMfaOpen(false);
        setStatus('RUNNING');
        appendLine('log', 'Código MFA enviado ao scraper.');
        break;
      case 'status':
        setStatus(event.status as Status);
        break;
      case 'error':
        appendLine('error', `✗ ${event.message ?? 'erro'}`);
        break;
      case 'done': {
        const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
        const stats = event.stats ?? payload?.stats ?? payload;
        appendLine('done', `✓ Sync concluída. ${JSON.stringify(stats)}`);
        setDataKey((k) => k + 1);
        closeStream();
        break;
      }
      default:
        break;
    }
  }

  async function submitMfa(code: string) {
    if (runId == null) return;
    try {
      await api.submitMfa(runId, code);
    } catch (err) {
      appendLine('error', `Falha ao enviar MFA: ${(err as Error).message}`);
    }
  }

  async function cancelSync() {
    if (runId == null) return;
    await api.cancelSync(runId);
    closeStream();
    setStatus('CANCELLED');
  }

  const running = status === 'RUNNING' || status === 'WAITING_MFA';

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>Qualicorp → Koter</h1>
          <div className="subtitle">
            Extração de planos do portal Qualicorp pra integração com o Koter
          </div>
        </div>
        <span className={`status-badge status-${status}`}>{status}</span>
      </div>

      <div className="panel">
        <h2>Sincronização</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button className="btn" onClick={startSync} disabled={running}>
            {running ? 'Em execução...' : 'Iniciar sync'}
          </button>
          {running && (
            <button className="btn ghost" onClick={cancelSync}>
              Cancelar
            </button>
          )}
        </div>
        <ProgressLog lines={lines} progressPct={progressPct} />
      </div>

      <div className="panel">
        <h2>Dados extraídos</h2>
        <DataExplorer refreshKey={dataKey} />
      </div>

      <MfaModal
        open={mfaOpen}
        reason={mfaReason}
        onSubmit={submitMfa}
        onCancel={() => setMfaOpen(false)}
      />
    </div>
  );
}
