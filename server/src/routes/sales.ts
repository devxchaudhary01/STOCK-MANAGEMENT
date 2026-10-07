import { Router } from 'express';
import { Item } from '../models';
import { asyncH, paging } from '../lib/http';
import { authRequired } from '../middleware/auth';
import { resolveItemFilter } from '../lib/itemQuery';
import { pendingFor } from '../services/orders';

export const salesRouter = Router();
salesRouter.use(authRequired);

/** Sales panel search: available stock + pending in order + expected date (no supplier, no criteria shown to sales). */
salesRouter.get('/search', asyncH(async (req, res) => {
  const { limit } = paging({ limit: req.query.limit || 20 }, 50); const filter = await resolveItemFilter({ q: String(req.query.q || '') });
  if (!String(req.query.q || '').trim()) return void res.json({ items: [] });
  const items = await Item.find(filter, 'name code currentStock status').sort({ name: 1 }).limit(limit).lean(); const pend = await pendingFor(items.map(i => i._id));
  res.json({ items: items.map(i => { const p = pend.get(String(i._id)); return { _id: i._id, name: i.name, code: i.code, available: i.currentStock, status: i.status, pendingOrderQty: p?.pendingQty || 0, expectedDate: p?.expectedDate || null, incoming: p?.incoming || [] }; }) });
}));
