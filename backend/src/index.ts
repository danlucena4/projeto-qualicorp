import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import './db/index.js';
import { syncRouter } from './routes/sync.js';
import { plansRouter } from './routes/plans.js';
import { extractionRouter } from './routes/extraction.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'projeto-qualicorp-backend' });
});

app.use('/api/sync', syncRouter);
app.use('/api/plans', plansRouter);
app.use('/api/pdfs', extractionRouter);

app.listen(config.backend.port, () => {
  console.log(`[backend] listening on http://localhost:${config.backend.port}`);
});
