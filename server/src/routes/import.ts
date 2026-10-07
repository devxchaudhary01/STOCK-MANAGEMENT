import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authRequired, requireRole, actor } from '../middleware/auth';
import { asyncH, parse, paging } from '../lib/http';
import { config } from '../config';
import { HttpError } from '../services/stock';
import { ImportLog, Invoice, Item, Supplier } from '../models';
import { readWorkbook, detectHeaderRow, suggestMapping, SheetData } from '../lib/excel';
import { getFile, putFile, sniff, MIME } from '../lib/storage';
import { commitEntries, commitMaster, commitQty, previewMaster, previewQty, rollbackImport } from '../services/importService';
import { parseYmd, ymdToday } from '../lib/http';
import { getOcrProvider } from '../lib/ocr';
import { matchOcrLines } from '../lib/ocr/match';

export const importRouter = Router();
importRouter.use(authRequired);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });

// small parse cache so preview/commit don't re-read the workbook every click
const cache = new Map<string, { sheets: SheetData[]; t: number }>();
async function sheetsFor(logId: string): Promise<{ sheets: SheetData[]; log: any }> {
  const log = await ImportLog.findById(logId); if (!log || !log.storageKey) throw new HttpError(404, 'Import session not found');
  const hit = cache.get(logId); if (hit && Date.now() - hit.t < 600_000) return { sheets: hit.sheets, log };
  const sheets = await readWorkbook(await getFile(log.storageKey)); cache.set(logId, { sheets, t: Date.now() });
  if (cache.size > 8) cache.delete(cache.keys().next().value!); return { sheets, log };
}

/** Step 1-3: upload, read and detect columns. Nothing is written to the item database. */
importRouter.post('/upload', upload.single('file'), asyncH(async (req, res) => {
  const kind = parse(z.enum(['MASTER', 'STOCK_QTY', 'ENTRY']), req.body.kind); if (kind !== 'ENTRY' && req.user!.role !== 'ADMIN') throw new HttpError(403, 'Admin access required'); const f = req.file; if (!f) throw new HttpError(400, 'No file uploaded');
  const t = sniff(f.buffer); if (!t || !['xlsx', 'xls', 'csv'].includes(t)) throw new HttpError(400, 'Only Excel (.xlsx/.xls) or CSV files are allowed');
  let sheets: SheetData[]; try { sheets = await readWorkbook(f.buffer); } catch { throw new HttpError(400, 'Could not read this file. Is it a valid Excel/CSV file?'); }
  const key = await putFile(f.buffer, t === 'csv' ? 'csv' : t, 'imports');
  const log = await ImportLog.create({ kind, fileName: f.originalname.slice(0, 200), storageKey: key, ...actor(req) }); cache.set(log.id, { sheets, t: Date.now() });
  res.status(201).json({ importId: log.id, fileName: log.fileName, sheets: sheets.map((s, index) => {
    const headerRow = detectHeaderRow(s.rows); const header = s.rows[headerRow] || [];
    return { index, name: s.name, rowCount: Math.max(s.rows.length - headerRow - 1, 0), headerRow, header: header.map((h: any) => (h === null ? '' : String(h))), suggestedMapping: suggestMapping(header),
      sample: s.rows.slice(headerRow + 1, headerRow + 9).map(r => r.map((c: any) => (c === null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : c))) };
  }) });
}));

const mapping = z.record(z.string(), z.number().int().min(0).max(200).nullable());
const resolution = z.union([z.object({ action: z.literal('LINK'), itemId: z.string().regex(/^[a-f\d]{24}$/i) }), z.object({ action: z.enum(['CREATE', 'SKIP', 'USE']) })]);
const runBody = z.object({
  sheet: z.number().int().min(0), headerRow: z.number().int().min(0), mapping,
  entry: z.object({ type: z.enum(['SALE', 'PURCHASE', 'REJECTION']), date: z.string().optional(), supplierId: z.string().optional(), party: z.string().max(120).optional(), docNo: z.string().max(60).optional(), docType: z.enum(['INVOICE', 'CHALLAN']).optional(), direction: z.enum(['IN', 'OUT']).optional(), remarks: z.string().max(300).optional() }).optional(),
  options: z.object({ forcePriority: z.boolean().nullable().optional(), blankStockAsZero: z.boolean().optional(), useBoldCategories: z.boolean().optional(), mode: z.enum(['SET', 'ADD']).optional() }).default({}),
  resolutions: z.record(z.string(), resolution).default({}),
});
const num = (r: Record<string, any>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [Number(k), v]));

async function run(req: any, commit: boolean) {
  const b = parse(runBody, req.body); const { sheets, log } = await sheetsFor(req.params.id); const sheet = sheets[b.sheet]; if (!sheet) throw new HttpError(400, 'Sheet not found');
  const m = b.mapping as any; if (m.name == null && m.code == null) throw new HttpError(400, 'Map the Item Name (or Item Code) column first');
  if (log.kind !== 'ENTRY' && req.user!.role !== 'ADMIN') throw new HttpError(403, 'Admin access required');
  if (log.kind !== 'MASTER' && m.currentStock == null) throw new HttpError(400, 'Map the Quantity column first');
  const res = num(b.resolutions) as any; const meta = { fileName: log.fileName, storageKey: log.storageKey, sheetName: sheet.name, logId: log.id };
  if (log.kind === 'ENTRY') {
    const e = b.entry; if (!e) throw new HttpError(400, 'Choose what this file is (sale / purchase / rejection)');
    if (req.user!.role !== 'ADMIN' && e.type !== 'SALE') throw new HttpError(403, 'Only admin can enter purchases and rejections');
    if (!commit) return { kind: 'ENTRY', plan: await previewQty(sheet, m, { headerRow: b.headerRow, mode: 'ADD' }, res) };
    if (e.type === 'PURCHASE' && !e.supplierId) throw new HttpError(400, 'Choose the supplier');
    return { kind: 'ENTRY', ...(await commitEntries(sheet, m, { headerRow: b.headerRow }, res, { ...e, date: parseYmd(e.date || ymdToday()) }, meta, actor(req) as any)) };
  }
  if (log.kind === 'MASTER') {
    const opts = { headerRow: b.headerRow, forcePriority: b.options.forcePriority, blankStockAsZero: b.options.blankStockAsZero ?? false, useBoldCategories: b.options.useBoldCategories ?? true };
    return commit ? { kind: 'MASTER', ...(await commitMaster(sheet, m, opts, res, meta, actor(req))) } : { kind: 'MASTER', plan: await previewMaster(sheet, m, opts, res) };
  }
  const opts = { headerRow: b.headerRow, mode: b.options.mode ?? 'SET' } as const;
  return commit ? { kind: 'STOCK_QTY', ...(await commitQty(sheet, m, opts, res, meta, actor(req))) } : { kind: 'STOCK_QTY', plan: await previewQty(sheet, m, opts, res) };
}
/** Step 4-8: PREVIEW only (new / existing / duplicate / missing / invalid). Never writes items. */
importRouter.post('/:id/preview', asyncH(async (req, res) => res.json(await run(req, false))));
/** Step 9-10: apply. Requires explicit confirm:true. */
importRouter.post('/:id/commit', asyncH(async (req, res) => {
  if (req.body?.confirm !== true) throw new HttpError(400, 'Confirmation required'); res.json(await run(req, true));
}));
importRouter.get('/logs', requireRole('ADMIN'), asyncH(async (req, res) => {
  const { limit, page, skip } = paging(req.query, 100); const f = { status: { $ne: 'UPLOADED' } };
  const [rows, total] = await Promise.all([ImportLog.find(f, '-changes -options -mapping').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), ImportLog.countDocuments(f)]); res.json({ rows, total, page, pages: Math.ceil(total / limit) });
}));
importRouter.post('/logs/:id/rollback', requireRole('ADMIN'), asyncH(async (req, res) => res.json(await rollbackImport(String(req.params.id), actor(req)))));

// ---------------- Invoice photo / PDF -> OCR -> review (NEVER changes stock) ----------------
importRouter.post('/invoice', upload.single('file'), asyncH(async (req, res) => {
  const f = req.file; if (!f) throw new HttpError(400, 'No file uploaded');
  const t = sniff(f.buffer); if (!t || !['pdf', 'png', 'jpg', 'webp'].includes(t)) throw new HttpError(400, 'Only JPG, PNG, WEBP or PDF invoices are allowed');
  const key = await putFile(f.buffer, t, 'invoices');
  const inv = await Invoice.create({ originalName: f.originalname.slice(0, 200), mime: MIME[t], size: f.size, storageKey: key, uploadedBy: req.user!.id });
  const provider = getOcrProvider(); let lines: { rawName: string; quantity: number | null }[] = []; let ocrError: string | undefined;
  try { lines = await provider.extract({ buffer: f.buffer, mime: MIME[t], filename: f.originalname }); inv.status = 'EXTRACTED'; inv.set('extracted', lines.map(l => ({ rawName: l.rawName, quantity: l.quantity ?? undefined }))); }
  catch (e: any) { ocrError = e.message; inv.status = 'FAILED'; inv.error = e.message; }
  inv.provider = provider.name; await inv.save();
  const items = (await Item.find({ active: true }, 'name code').lean()).map(i => ({ id: String(i._id), name: i.name, code: i.code }));
  res.status(201).json({ invoiceId: inv.id, provider: provider.name, ocrError, rows: matchOcrLines(lines, items) });
}));
/** Re-match edited text (after the user corrects an extracted line) */
importRouter.post('/invoice/match', asyncH(async (req, res) => {
  const b = parse(z.object({ lines: z.array(z.object({ rawName: z.string().max(300), quantity: z.number().nullable() })).max(500) }), req.body);
  const items = (await Item.find({ active: true }, 'name code').lean()).map(i => ({ id: String(i._id), name: i.name, code: i.code })); res.json({ rows: matchOcrLines(b.lines, items) });
}));
importRouter.get('/invoice/:id/file', asyncH(async (req, res) => {
  const inv = await Invoice.findById(req.params.id); if (!inv) throw new HttpError(404, 'Not found');
  res.setHeader('Content-Type', inv.mime || 'application/octet-stream'); res.setHeader('Content-Disposition', 'inline'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.send(await getFile(inv.storageKey));
}));
void Supplier;
