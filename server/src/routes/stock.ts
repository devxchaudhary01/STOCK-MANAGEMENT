import { Router } from 'express';
import { z } from 'zod';
import { StockTransaction, TXN_TYPES } from '../models';
import { asyncH, parse, paging, rangeFilter, parseYmd } from '../lib/http';
import { authRequired, requireRole, actor } from '../middleware/auth';
import { applyTransaction, reconcile } from '../services/stock';

export const stockRouter = Router();
stockRouter.use(authRequired);
stockRouter.use((req, _res, next) => (req.user!.role === 'ADMIN' ? next() : next(Object.assign(new Error('Admin access required'), { status: 403 }))));
const oid = z.string().regex(/^[a-f\d]{24}$/i);

export function txnFilter(q: any) {
  const f: any = {};
  if (q.type && (TXN_TYPES as readonly string[]).includes(q.type)) f.type = q.type;
  if (q.itemId && oid.safeParse(q.itemId).success) f.itemId = q.itemId;
  if (q.supplierId && oid.safeParse(q.supplierId).success) f.supplierId = q.supplierId;
  if (q.userId && oid.safeParse(q.userId).success) f.userId = q.userId;
  const r = rangeFilter(q); if (r) f.date = r; return f;
}
/** Server-side paginated ledger – never loads the whole collection. */
stockRouter.get('/transactions', asyncH(async (req, res) => {
  const { limit, page, skip } = paging(req.query, 200); const f = txnFilter(req.query);
  const [rows, total] = await Promise.all([StockTransaction.find(f).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).populate('itemId', 'name code').populate('supplierId', 'name').lean(), StockTransaction.countDocuments(f)]);
  res.json({ rows, total, page, pages: Math.ceil(total / limit) });
}));

/** Manual stock movement. PURCHASE has its own endpoint (/api/purchases). ADJUSTMENT takes a signed quantity. */
stockRouter.post('/transaction', asyncH(async (req, res) => {
  const b = parse(z.object({
    itemId: oid, type: z.enum(['ADJUSTMENT', 'STOCK_OUT', 'RETURN', 'OPENING_STOCK']), quantity: z.number().finite().refine(n => n !== 0, 'Quantity cannot be 0').refine(n => Math.abs(n) <= 1_000_000),
    date: z.string().optional(), remarks: z.string().trim().max(300).optional(), reference: z.string().trim().max(100).optional(),
  }), req.body);
  if (b.type === 'ADJUSTMENT' && !b.remarks) throw Object.assign(new Error('Remarks are required for a stock adjustment'), { status: 400 });
  const r = await applyTransaction({ ...b, date: b.date ? parseYmd(b.date) : undefined, ...actor(req) });
  res.status(201).json({ transaction: r.txn, currentStock: r.item.currentStock, status: r.item.status });
}));
/** Compare stored stock with the transaction ledger (ADMIN). ?fix=true repairs drift. */
stockRouter.post('/reconcile', requireRole('ADMIN'), asyncH(async (req, res) => res.json(await reconcile(req.query.fix === 'true'))));
