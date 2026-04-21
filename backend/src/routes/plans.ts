import { Router } from 'express';
import {
  listStates,
  listQcOperators,
  listQcEntities,
  listQcTables,
  countQcTables,
  getCounts,
} from '../db/index.js';

export const plansRouter = Router();

plansRouter.get('/stats', (_req, res) => {
  res.json(getCounts());
});

plansRouter.get('/states', (_req, res) => {
  res.json(listStates());
});

plansRouter.get('/operators', (_req, res) => {
  res.json(listQcOperators());
});

plansRouter.get('/entities', (_req, res) => {
  res.json(listQcEntities());
});

plansRouter.get('/tables', (req, res) => {
  const filters = {
    uf: req.query.uf ? String(req.query.uf) : undefined,
    operatorId: req.query.operatorId ? Number(req.query.operatorId) : undefined,
    entityId: req.query.entityId ? Number(req.query.entityId) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : 100,
    offset: req.query.offset ? Number(req.query.offset) : 0,
  };
  const total = countQcTables(filters);
  const items = listQcTables(filters);
  res.json({ total, items });
});
