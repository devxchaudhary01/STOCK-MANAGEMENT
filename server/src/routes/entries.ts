import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Item, StockTransaction, Supplier } from '../models';
import { asyncH, parse, paging, parseYmd, rangeFilter, ymdToday, dayStart, addDays, escapeRegex } from '../lib/http';
import { authRequired, actor } from '../middleware/auth';
import { HttpError, applyTransaction } from '../services/stock';
import { recordLine } from '../services/entries';
import { config } from '../config';

export const entriesRouter = Router();
entriesRouter.use(authRequired);
const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/** Daily entry: sale / purchase (invoice or challan) / rejection, many lines at once. Sales users may only enter SALE. */
entriesRouter.post('/batch', asyncH(async (req, res) => {
  const b = parse(z.object({
    type: z.enum(['SALE', 'PURCHASE', 'REJECTION']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), party: z.string().trim().max(120).optional(), supplierId: oid.optional(),
    docNo: z.string().trim().max(60).optional(), docType: z.enum(['INVOICE', 'CHALLAN']).optional(), invoiceId: oid.optional(), direction: z.enum(['IN', 'OUT']).optional(), remarks: z.string().trim().max(300).optional(),
    lines: z.array(z.object({ itemId: oid, quantity: z.number().finite().positive().max(1_000_000) })).min(1).max(500) }), req.body);
  if (req.user!.role !== 'ADMIN' && b.type !== 'SALE') throw new HttpError(403, 'Only admin can enter purchases, challans and rejections');
  if (b.type === 'PURCHASE' && !(await Supplier.exists({ _id: b.supplierId, active: true }))) throw new HttpError(400, 'Choose an active supplier');
  const ids = [...new Set(b.lines.map(l => l.itemId))];
  const items = await Item.find({ _id: { $in: ids }, active: true }, 'name currentStock').lean(); if (items.length !== ids.length) throw new HttpError(400, 'One or more items do not exist in the item list');
  // pre-check stock for outgoing entries so a multi-line sale fails as a whole, before anything is booked
  if (b.type === 'SALE' || (b.type === 'REJECTION' && b.direction === 'OUT')) {
    const need = new Map<string, number>(); for (const l of b.lines) need.set(l.itemId, (need.get(l.itemId) || 0) + l.quantity);
    for (const it of items) if ((need.get(String(it._id)) || 0) > it.currentStock) throw new HttpError(409, `Not enough stock for ${it.name}: only ${it.currentStock} available, you asked for ${need.get(String(it._id))}`);
  }
  const ctx = { ...actor(req) as { userId: string; userName: string }, date: parseYmd(b.date || ymdToday()), remarks: b.remarks, docNo: b.docNo, party: b.party, supplierId: b.supplierId, docType: b.docType, invoiceId: b.invoiceId, direction: b.direction };
  const out = []; for (const l of b.lines) { const r = await recordLine(b.type, l.itemId, l.quantity, ctx); out.push({ itemId: l.itemId, name: items.find(i => String(i._id) === l.itemId)!.name, quantity: l.quantity, newStock: r.item.currentStock, status: r.item.status, txnId: r.txn.id }); }
  res.status(201).json({ created: out.length, lines: out });
}));

/** Entry feed. Admin sees everyone (filter by employee); Sales sees only their own sales. */
entriesRouter.get('/', asyncH(async (req, res) => {
  const { limit, page, skip } = paging(req.query, 200); const q: any = req.query; const f: any = {};
  const types = req.user!.role === 'ADMIN' ? ['SALE', 'PURCHASE', 'REJECTION'] : ['SALE']; f.type = types.includes(q.type) ? q.type : { $in: types };
  if (req.user!.role !== 'ADMIN') f.userId = req.user!.id; else if (q.userId && oid.safeParse(q.userId).success) f.userId = q.userId;
  if (q.itemId && oid.safeParse(q.itemId).success) f.itemId = q.itemId; if (q.party) f.party = new RegExp(escapeRegex(String(q.party)), 'i');
  if (q.hideCancelled === 'true') f.cancelled = { $ne: true }; const r = rangeFilter(q); if (r) f.date = r;
  const [rows, total] = await Promise.all([StockTransaction.find(f).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).populate('itemId', 'name').populate('supplierId', 'name').lean(), StockTransaction.countDocuments(f)]);
  res.json({ rows, total, page, pages: Math.ceil(total / limit) });
}));

/** Cancel a sale / rejection (writes a reversing entry; original stays visible, marked cancelled). Sales: own entries, today only. */
entriesRouter.post('/:id/cancel', asyncH(async (req, res) => {
  const t = await StockTransaction.findById(oid.parse(req.params.id)); if (!t) throw new HttpError(404, 'Entry not found');
  if (!['SALE', 'REJECTION'].includes(t.type)) throw new HttpError(400, 'Only sales and rejections can be cancelled here (purchases: use Purchases > Cancel)');
  if (t.cancelled) throw new HttpError(409, 'Already cancelled');
  if (req.user!.role !== 'ADMIN') {
    if (String(t.userId) !== req.user!.id) throw new HttpError(403, 'You can cancel only your own entries');
    const today = ymdToday(); if (t.createdAt! < dayStart(today) || t.createdAt! >= dayStart(addDays(today, 1))) throw new HttpError(403, 'You can cancel only today\'s entries. Ask admin.');
  }
  t.cancelled = true; await t.save();
  const r = await applyTransaction({ itemId: t.itemId, type: 'ADJUSTMENT', quantity: -t.quantity, reference: t.reference || undefined, party: t.party || undefined, reversalOf: t._id, remarks: `Cancelled ${t.type.toLowerCase()} ${t.id}`, ...actor(req) });
  res.json({ ok: true, newStock: r.item.currentStock, config: config.tz });
}));
void Types;
