import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Purchase, Supplier, Item, Invoice, StockTransaction } from '../models';
import { asyncH, parse, paging, rangeFilter, parseYmd, ymdToday } from '../lib/http';
import { authRequired, requireRole, actor } from '../middleware/auth';
import { HttpError, applyTransaction } from '../services/stock';
import { recordLine } from '../services/entries';
import { reverseAllocations } from '../services/orders';
import multer from 'multer';
import { config } from '../config';
import { putFile, sniff, MIME } from '../lib/storage';

export const purchasesRouter = Router();
purchasesRouter.use(authRequired);
purchasesRouter.use((req, _res, next) => (req.user!.role === 'ADMIN' ? next() : next(Object.assign(new Error('Admin access required'), { status: 403 }))));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });
const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const qty = z.number().finite().positive('Quantity must be greater than 0').max(1_000_000);
const base = { docType: z.enum(['INVOICE', 'CHALLAN']).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), supplierId: oid, invoiceNumber: z.string().trim().max(60).optional(), invoiceId: oid.optional(), remarks: z.string().trim().max(300).optional() };

export function purchaseFilter(q: any) {
  const f: any = { status: q.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE' };
  if (q.supplierId && oid.safeParse(q.supplierId).success) f.supplierId = q.supplierId;
  if (q.itemId && oid.safeParse(q.itemId).success) f.itemId = q.itemId;
  if (q.invoice) f.invoiceNumber = new RegExp('^' + String(q.invoice).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const r = rangeFilter(q); if (r) f.date = r; return f;
}
purchasesRouter.get('/', asyncH(async (req, res) => {
  const { limit, page, skip } = paging(req.query, 200); const f = purchaseFilter(req.query);
  const [rows, total, sum] = await Promise.all([
    Purchase.find(f).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).populate('supplierId', 'name').populate('itemId', 'name code').lean(),
    Purchase.countDocuments(f), Purchase.aggregate([{ $match: { ...f, supplierId: f.supplierId ? new Types.ObjectId(f.supplierId) : { $exists: true } } }, { $group: { _id: null, qty: { $sum: '$quantity' } } }])]);
  res.json({ rows, total, page, pages: Math.ceil(total / limit), totalQuantity: sum[0]?.qty || 0 });
}));

async function createOne(b: { date?: string; supplierId: string; itemId: string; quantity: number; invoiceNumber?: string; invoiceId?: string; remarks?: string; docType?: 'INVOICE' | 'CHALLAN' }, a: { userId: string; userName: string }) {
  const date = b.date ? parseYmd(b.date) : parseYmd(ymdToday());
  return recordLine('PURCHASE', b.itemId, b.quantity, { ...a, date, supplierId: b.supplierId, docNo: b.invoiceNumber, invoiceId: b.invoiceId, remarks: b.remarks, docType: b.docType });
}
/** Purchase entry: creates the purchase AND a PURCHASE stock transaction, which increases current stock. */
purchasesRouter.post('/', asyncH(async (req, res) => {
  const b = parse(z.object({ ...base, itemId: oid, quantity: qty }), req.body);
  if (!(await Supplier.exists({ _id: b.supplierId, active: true }))) throw new HttpError(400, 'Supplier not found or inactive');
  const r = await createOne(b, actor(req));
  res.status(201).json({ id: (r.purchase as any).id, newStock: r.item.currentStock, status: r.item.status });
}));
/** Several lines on one invoice (used by the invoice-OCR confirm step). */
purchasesRouter.post('/bulk', asyncH(async (req, res) => {
  const b = parse(z.object({ ...base, lines: z.array(z.object({ itemId: oid, quantity: qty })).min(1).max(500) }), req.body);
  if (!(await Supplier.exists({ _id: b.supplierId, active: true }))) throw new HttpError(400, 'Supplier not found or inactive');
  const ids = [...new Set(b.lines.map(l => l.itemId))]; if ((await Item.countDocuments({ _id: { $in: ids } })) !== ids.length) throw new HttpError(400, 'One or more items no longer exist');
  const { lines, ...head } = b; const out = [];
  for (const l of lines) { const r = await createOne({ ...head, ...l }, actor(req)); out.push({ id: (r.purchase as any).id, itemId: l.itemId, newStock: r.item.currentStock }); }
  if (b.invoiceId) await Invoice.updateOne({ _id: b.invoiceId }, { $set: { status: 'CONFIRMED' } });
  res.status(201).json({ created: out.length, purchases: out });
}));
/** Cancel a purchase: marks it CANCELLED and writes a reversing ADJUSTMENT so the audit trail stays intact. */
purchasesRouter.delete('/:id', requireRole('ADMIN'), asyncH(async (req, res) => {
  const p = await Purchase.findById(oid.parse(req.params.id)); if (!p) throw new HttpError(404, 'Purchase not found'); if (p.status === 'CANCELLED') throw new HttpError(409, 'Already cancelled');
  await applyTransaction({ itemId: p.itemId, type: 'ADJUSTMENT', quantity: -p.quantity, supplierId: p.supplierId, purchaseId: p._id, reference: p.invoiceNumber || undefined, remarks: `Cancelled purchase ${p.id}`, ...actor(req) });
  await reverseAllocations(p.allocations || []); p.status = 'CANCELLED'; await p.save(); res.json({ ok: true });
}));

/** Attach an invoice photo/PDF to a purchase (no OCR). The file goes to storage; only a reference is kept in MongoDB. */
purchasesRouter.post('/invoice-file', upload.single('file'), asyncH(async (req, res) => {
  const f = req.file; if (!f) throw new HttpError(400, 'No file uploaded');
  const t = sniff(f.buffer); if (!t || !['pdf', 'png', 'jpg', 'webp'].includes(t)) throw new HttpError(400, 'Only JPG, PNG, WEBP or PDF files are allowed');
  const inv = await Invoice.create({ originalName: f.originalname.slice(0, 200), mime: MIME[t], size: f.size, storageKey: await putFile(f.buffer, t, 'invoices'), uploadedBy: req.user!.id });
  res.status(201).json({ invoiceId: inv.id });
}));
