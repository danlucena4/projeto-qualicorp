import { Router } from 'express';
import { insertSyncRun, updateSyncRun, listSyncRuns, getSyncRun } from '../db/index.js';
import { syncBus } from '../scraper/events.js';
import { runQualicorpSync } from '../scraper/qualicorp.js';
import {
  getActiveRun,
  setActiveRun,
  submitMfaCode,
} from '../scraper/session.js';

export const syncRouter = Router();

syncRouter.post('/start', async (req, res) => {
  if (getActiveRun()) {
    res.status(409).json({ error: 'Já existe um sync em execução' });
    return;
  }

  const runId = insertSyncRun('RUNNING');
  const abort = new AbortController();
  setActiveRun({ runId, abort, mfaResolver: null });
  syncBus.emitEvent({ type: 'status', runId, status: 'RUNNING' });

  // Executa o sync em background, sem bloquear o response.
  (async () => {
    try {
      const stats = await runQualicorpSync({ runId, signal: abort.signal });
      updateSyncRun(runId, { status: 'SUCCESS', stats, finishedAt: true });
      syncBus.emitEvent({ type: 'status', runId, status: 'SUCCESS' });
      syncBus.emitEvent({ type: 'done', runId, stats: stats as Record<string, number> });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateSyncRun(runId, { status: 'FAILED', error: message, finishedAt: true });
      syncBus.emitEvent({ type: 'error', runId, message });
      syncBus.emitEvent({ type: 'status', runId, status: 'FAILED' });
    } finally {
      setActiveRun(null);
    }
  })();

  res.json({ runId });
});

syncRouter.post('/:id/mfa', (req, res) => {
  const runId = Number(req.params.id);
  const { code } = req.body ?? {};
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Campo code ausente' });
    return;
  }
  const ok = submitMfaCode(runId, code.trim());
  if (!ok) {
    res.status(404).json({ error: 'Sync não está aguardando MFA' });
    return;
  }
  res.json({ ok: true });
});

syncRouter.post('/:id/cancel', (req, res) => {
  const runId = Number(req.params.id);
  const active = getActiveRun();
  if (!active || active.runId !== runId) {
    res.status(404).json({ error: 'Sync não está em execução' });
    return;
  }
  active.abort.abort();
  updateSyncRun(runId, { status: 'CANCELLED', finishedAt: true });
  syncBus.emitEvent({ type: 'status', runId, status: 'CANCELLED' });
  setActiveRun(null);
  res.json({ ok: true });
});

syncRouter.get('/', (_req, res) => {
  res.json(listSyncRuns());
});

syncRouter.get('/:id', (req, res) => {
  const run = getSyncRun(Number(req.params.id));
  if (!run) {
    res.status(404).json({ error: 'Run não encontrada' });
    return;
  }
  res.json(run);
});

// SSE — stream de eventos em tempo real de um run.
syncRouter.get('/:id/stream', (req, res) => {
  const runId = Number(req.params.id);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const listener = (e: unknown) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  syncBus.on(`run:${runId}`, listener);

  // Replay dos eventos anteriores.
  const run = getSyncRun(runId) as { events?: unknown[] } | null;
  if (run && run.events) {
    for (const ev of run.events) {
      res.write(`data: ${JSON.stringify({ type: 'history', event: ev })}\n\n`);
    }
  }

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    syncBus.off(`run:${runId}`, listener);
  });
});
