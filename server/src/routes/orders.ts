import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { Item, OrderLine, Supplier } from '../models';
import { asyncH, parse, paging, parseYmd, rangeFilter, ymdToday } from '../lib/http';
import { authRequired, requireRole, actor } from '../middleware/auth';
import { HttpError } from '../services/stock';
import { pendingFor } from '../services/orders';
import { buildItemFilter } from '../lib/itemQuery';

export const ordersRouter = Router();
ordersRouter.use(authRequired, requireRole('ADMIN'));
const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const newOrderNo = () => `PO-${ymdToday().replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

/** Orders placed with suppliers (what admin ordered, how much, expected date). Sales team sees only qty + expected date, via /api/sales. */
ordersRouter.get('/', asyncH(async (req, res) => {
  const { limit, page, skip } = paging(req.query, 200); const q: any = req.query; const f: any = {};
  f.status = ['OPEN', 'RECEIVED', 'CANCELLED'].includes(q.status) ? q.status : q.status === 'all' ? { $in: ['OPEN', 'RECEIVED', 'CANCELLED'] } : 'OPEN';
  if (oid.safeParse(q.supplierId).success) f.supplierId = q.supplierId; if (oid.safeParse(q.itemId).success) f.itemId = q.itemId;
  const r = rangeFilter(q); if (r) f.orderDate = r;
  const [rows, total] = await Promise.all([OrderLine.find(f).sort({ expectedDate: 1, orderDate: -1 }).skip(skip).limit(limit).populate('supplierId', 'name').populate('itemId', 'name').lean(), OrderLine.countDocuments(f)]);
  res.json({ rows, total, page, pages: Math.ceil(total / limit) });
}));

ordersRouter.post('/', asyncH(async (req, res) => {
  const b = parse(z.object({ supplierId: oid, expectedDate: ymd, orderDate: ymd.optional(), orderNo: z.string().trim().max(40).optional(), remarks: z.string().trim().max(300).optional(), lines: z.array(z.object({ itemId: oid, quantity: z.number().finite().positive().max(1_000_000) })).min(1).max(500) }), req.body);
  if (!(await Supplier.exists({ _id: b.supplierId, active: true }))) throw new HttpError(400, 'Choose an active supplier');
  const ids = [...new Set(b.lines.map(l => l.itemId))]; if ((await Item.countDocuments({ _id: { $in: ids } })) !== ids.length) throw new HttpError(400, 'One or more items do not exist in the item list');
  const orderNo = b.orderNo || newOrderNo(); const orderDate = parseYmd(b.orderDate || ymdToday()); const expectedDate = parseYmd(b.expectedDate);
  await OrderLine.insertMany(b.lines.map(l => ({ orderNo, supplierId: b.supplierId, itemId: l.itemId, quantity: l.quantity, orderDate, expectedDate, remarks: b.remarks, ...actor(req) })));
  res.status(201).json({ orderNo, lines: b.lines.length });
}));

/** One click from the Reorder list: order everything still required from a supplier (minus what is already on order). */
ordersRouter.post('/from-reorder', asyncH(async (req, res) => {
  const b = parse(z.object({ supplierId: oid, expectedDate: ymd, remarks: z.string().trim().max(300).optional() }), req.body);
  if (!(await Supplier.exists({ _id: b.supplierId, active: true }))) throw new HttpError(400, 'Choose an active supplier');
  const items = await Item.find(await buildItemFilter({ view: 'order', supplierId: b.supplierId }), 'suggestedOrderQty').limit(2000).lean();
  const pend = await pendingFor(items.map(i => i._id)); const lines = items.map(i => ({ itemId: i._id, quantity: i.suggestedOrderQty - (pend.get(String(i._id))?.pendingQty || 0) })).filter(l => l.quantity > 0);
  if (!lines.length) throw new HttpError(409, 'Nothing left to order: everything required is already on order');
  const orderNo = newOrderNo(); const orderDate = parseYmd(ymdToday()); const expectedDate = parseYmd(b.expectedDate);
  await OrderLine.insertMany(lines.map(l => ({ orderNo, supplierId: b.supplierId, itemId: l.itemId, quantity: l.quantity, orderDate, expectedDate, remarks: b.remarks, ...actor(req) })));
  res.status(201).json({ orderNo, lines: lines.length, totalQty: lines.reduce((a, l) => a + l.quantity, 0) });
}));

ordersRouter.put('/lines/:id', asyncH(async (req, res) => {
  const b = parse(z.object({ expectedDate: ymd.optional(), quantity: z.number().positive().max(1_000_000).optional(), cancel: z.boolean().optional() }), req.body);
  const l = await OrderLine.findById(oid.parse(req.params.id)); if (!l) throw new HttpError(404, 'Order line not found'); if (l.status === 'RECEIVED') throw new HttpError(409, 'Already fully received');
  if (b.expectedDate) l.expectedDate = parseYmd(b.expectedDate); if (b.quantity) { if (b.quantity < l.receivedQty) throw new HttpError(400, `Already received ${l.receivedQty}`); l.quantity = b.quantity; l.status = l.receivedQty >= l.quantity ? 'RECEIVED' : 'OPEN'; }
  if (b.cancel) l.status = 'CANCELLED'; await l.save(); res.json({ ok: true });
}));
