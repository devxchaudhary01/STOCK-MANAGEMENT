import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import * as XLSX from 'xlsx';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { seed } from '../src/scripts/seed';
import { Item, StockTransaction, Supplier, User } from '../src/models';
import { setOcrProvider } from '../src/lib/ocr';
import bcrypt from 'bcryptjs';

const app = createApp(); let tok = ''; let staff = ''; const auth = (t = tok) => ({ Authorization: `Bearer ${t}` });
let deepak = '', ashish = ''; let itemA = '', itemB = '', itemC = '';
const LARGE_N = Number(process.env.LARGE_N || 5000);

beforeAll(async () => {
  await mongoose.connect(config.mongoUri); await mongoose.connection.dropDatabase(); await seed();
  tok = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'TestAdmin123!' })).body.token;
  await User.create({ username: 'staff', name: 'Staff', role: 'SALES', passwordHash: await bcrypt.hash('StaffPass123', 10) });
  staff = (await request(app).post('/api/auth/login').send({ username: 'staff', password: 'StaffPass123' })).body.token;
  const s = (await request(app).get('/api/suppliers').set(auth())).body.suppliers; deepak = s.find((x: any) => x.name === 'Deepak')._id; ashish = s.find((x: any) => x.name === 'Ashish')._id;
});
afterAll(async () => { await mongoose.disconnect(); });

describe('17. authentication & authorisation', () => {
  it('rejects anonymous, bad password and bad token', async () => {
    expect((await request(app).get('/api/items')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ username: 'admin', password: 'nope' })).status).toBe(401);
    expect((await request(app).get('/api/items').set(auth('garbage'))).status).toBe(401);
  });
  it('seeded admin can log in; password hash is never returned', async () => {
    const r = await request(app).get('/api/auth/me').set(auth()); expect(r.body.user.role).toBe('ADMIN'); expect(JSON.stringify(r.body)).not.toContain('passwordHash');
  });
  it('SALES can read items but not edit criteria / suppliers', async () => {
    expect((await request(app).get('/api/items').set(auth(staff))).status).toBe(200);
    expect((await request(app).get('/api/dashboard').set(auth(staff))).status).toBe(403);
    expect((await request(app).get('/api/purchases').set(auth(staff))).status).toBe(403);
    expect((await request(app).post('/api/items').set(auth(staff)).send({ name: 'X' })).status).toBe(403);
    expect((await request(app).post('/api/suppliers').set(auth(staff)).send({ name: 'Z' })).status).toBe(403);
  });
  it('NoSQL operator injection in login is neutralised', async () => {
    expect((await request(app).post('/api/auth/login').send({ username: { $ne: '' }, password: { $ne: '' } })).status).toBe(400);
  });
});

describe('items, criteria and status', () => {
  it('creates items with Target+% and Target+direct level, and shows which rule is used', async () => {
    const a = await request(app).post('/api/items').set(auth()).send({ special: true, name: 'BTJNL 2525 M15', priority: 'TOP', supplierId: deepak, targetStock: 30, openingStock: 12 }); expect(a.status).toBe(201); itemA = a.body.id;
    const b = await request(app).post('/api/items').set(auth()).send({ special: true, name: 'TNMG 160408', supplierId: ashish, targetStock: 100, reorderLevel: 40, openingStock: 80 }); itemB = b.body.id;
    const c = await request(app).post('/api/items').set(auth()).send({ special: true, name: 'Boring Bar ABC', openingStock: 10 }); itemC = c.body.id;
    const A = (await request(app).get(`/api/items/${itemA}`).set(auth())).body.item; expect(A).toMatchObject({ status: 'ORDER_REQUIRED', effectiveReorderLevel: 15, ruleUsed: 'DEFAULT_PERCENT', suggestedOrderQty: 18, currentStock: 12 });
    const B = (await request(app).get(`/api/items/${itemB}`).set(auth())).body.item; expect(B).toMatchObject({ status: 'GOOD', ruleUsed: 'DIRECT_LEVEL', effectiveReorderLevel: 40 });
    const C = (await request(app).get(`/api/items/${itemC}`).set(auth())).body.item; expect(C.status).toBe('NOT_SET');
  });
  it('rejects duplicate names and a reorder level above target', async () => {
    expect((await request(app).post('/api/items').set(auth()).send({ special: true, name: 'btjnl  2525 m15' })).status).toBe(409);
    expect((await request(app).put(`/api/items/${itemA}`).set(auth()).send({ reorderLevel: 99 })).status).toBe(400);
  });
  it('admin can change criteria later without code changes (status re-derived)', async () => {
    await request(app).put(`/api/items/${itemC}`).set(auth()).send({ targetStock: 100, reorderPct: 80 });
    const C = (await request(app).get(`/api/items/${itemC}`).set(auth())).body.item; expect(C).toMatchObject({ status: 'ORDER_REQUIRED', effectiveReorderLevel: 80, ruleUsed: 'ITEM_PERCENT' });
    await request(app).put(`/api/items/${itemC}`).set(auth()).send({ targetStock: null, reorderPct: null });
  });
  it('search by name, by supplier name, and server-side pagination', async () => {
    expect((await request(app).get('/api/items?q=btjnl 2525').set(auth())).body.total).toBe(1);
    expect((await request(app).get('/api/items?q=ashish').set(auth())).body.items[0].name).toBe('TNMG 160408');
    const p = (await request(app).get('/api/items?limit=2&page=2').set(auth())).body; expect(p.items.length).toBe(1); expect(p.total).toBe(3);
  });
});

describe('9. purchase increases stock via a transaction', () => {
  it('current 12 + purchase 30 = 42; ledger row has balanceAfter; last purchase set', async () => {
    const r = await request(app).post('/api/purchases').set(auth()).send({ date: '2026-10-03', supplierId: deepak, itemId: itemA, quantity: 30, invoiceNumber: 'INV-1024', remarks: 'test' });
    expect(r.status).toBe(201); expect(r.body.newStock).toBe(42); expect(r.body.status).toBe('GOOD');
    const t = (await request(app).get(`/api/items/${itemA}/transactions`).set(auth())).body.rows; expect(t.find((x: any) => x.type === 'PURCHASE')).toMatchObject({ quantity: 30, balanceAfter: 42 }); expect(t.some((x: any) => x.type === 'OPENING_STOCK')).toBe(true);
    expect((await request(app).get(`/api/items/${itemA}`).set(auth())).body.item.lastPurchaseQty).toBe(30);
  });
  it('rejects zero / negative / inactive supplier', async () => {
    expect((await request(app).post('/api/purchases').set(auth()).send({ supplierId: deepak, itemId: itemA, quantity: 0 })).status).toBe(400);
    expect((await request(app).post('/api/purchases').set(auth()).send({ supplierId: deepak, itemId: itemA, quantity: -5 })).status).toBe(400);
  });
  it('cancelling a purchase reverses stock with an audit row', async () => {
    const p = await request(app).post('/api/purchases').set(auth()).send({ supplierId: ashish, itemId: itemB, quantity: 5 });
    expect((await request(app).delete(`/api/purchases/${p.body.id}`).set(auth())).status).toBe(200);
    expect((await request(app).get(`/api/items/${itemB}`).set(auth())).body.item.currentStock).toBe(80);
  });
  it('stock adjustment needs remarks; ledger matches stored stock (reconcile = no drift)', async () => {
    expect((await request(app).post('/api/stock/transaction').set(auth()).send({ itemId: itemC, type: 'ADJUSTMENT', quantity: -3 })).status).toBe(400);
    expect((await request(app).post('/api/stock/transaction').set(auth()).send({ itemId: itemC, type: 'STOCK_OUT', quantity: 4, remarks: 'issued' })).status).toBe(201);
    expect((await request(app).get(`/api/items/${itemC}`).set(auth())).body.item.currentStock).toBe(6);
    expect((await request(app).post('/api/stock/reconcile').set(auth())).body.drift).toEqual([]);
  });
});

describe('15. supplier filtering, dashboard, reorder', () => {
  it('order list for one supplier only shows that supplier', async () => {
    await request(app).post('/api/stock/transaction').set(auth()).send({ itemId: itemB, type: 'STOCK_OUT', quantity: 60, remarks: 'used' });   // 80 -> 20, level 40 => order
    const d = (await request(app).get(`/api/reorder?supplierId=${ashish}`).set(auth())).body; expect(d.rows.map((r: any) => r.name)).toEqual(['TNMG 160408']); expect(d.rows[0].suggestedOrderQty).toBe(80);
    expect((await request(app).get(`/api/reorder?supplierId=${deepak}`).set(auth())).body.total).toBe(0);
  });
  it('dashboard cards are aggregated server-side and add up', async () => {
    const c = (await request(app).get('/api/dashboard').set(auth())).body.cards; expect(c.total).toBe(3); expect(c.topPriority).toBe(1); expect(c.good + c.low + c.orderRequired + c.outOfStock + c.notSet).toBe(3);
  });
  it('supplier page: totals and recent purchases', async () => {
    const s = (await request(app).get(`/api/suppliers/${deepak}`).set(auth())).body; expect(s.stats).toMatchObject({ purchaseTransactions: 1, totalQuantity: 30, distinctItems: 1 });
  });
  it('changing the default % setting recalculates items', async () => {
    const r = await request(app).put('/api/settings').set(auth()).send({ defaultReorderPct: 90 }); expect(r.body.itemsRecalculated).toBe(3);
    expect((await request(app).get(`/api/items/${itemA}`).set(auth())).body.item.effectiveReorderLevel).toBe(27); await request(app).put('/api/settings').set(auth()).send({ defaultReorderPct: 50 });
  });
});

describe('16. Excel export via API', () => {
  const dl = async (url: string) => { const r = await request(app).get(url).set(auth()).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); }); return r; };
  it.each(['current-stock', 'order-required', 'criteria-missing', 'daily?preset=month', 'supplier', 'transactions'])('report %s exports a valid xlsx', async (name) => {
    const r = await dl(`/api/reports/${name}${name.includes('?') ? '&' : '?'}format=xlsx`); expect(r.status).toBe(200); expect(r.headers['content-type']).toContain('spreadsheetml');
    const wb = XLSX.read(r.body, { type: 'buffer' }); expect(wb.SheetNames.length).toBe(1);
  });
  it('order-required export for one supplier contains only that supplier', async () => {
    const r = await dl(`/api/reports/order-required?format=xlsx&supplierId=${ashish}`); const rows = XLSX.utils.sheet_to_json<any[]>(XLSX.read(r.body, { type: 'buffer' }).Sheets['Order Required Report'.slice(0, 31)], { header: 1 });
    expect(rows.slice(3).map(x => x[0])).toEqual(['TNMG 160408']);
  });
});

describe('bulk quantity import (preview -> confirm)', () => {
  const xlsx = (rows: any[][]) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'S'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer; };
  it('previews matched/unmatched/duplicate/invalid, changes nothing until confirm, then applies and can roll back', async () => {
    const up = await request(app).post('/api/import/upload').set(auth()).field('kind', 'STOCK_QTY').attach('file', xlsx([['Item Name', 'Quantity'], ['BTJNL 2525 M15', 50], ['Unknown Thing', 4], ['TNMG 160408', 7], ['tnmg 160408', 9], ['Boring Bar ABC', 'abc']]), 'q.xlsx');
    expect(up.status).toBe(201); const id = up.body.importId; const sh = up.body.sheets[0]; expect(sh.suggestedMapping.name).toBe(0);
    const body = { sheet: 0, headerRow: sh.headerRow, mapping: { name: 0, currentStock: 1 }, options: { mode: 'SET' } };
    const pv = (await request(app).post(`/api/import/${id}/preview`).set(auth()).send(body)).body.plan; expect(pv.summary).toMatchObject({ matched: 1, unmatched: 1, duplicates: 2, invalid: 1, willApply: 1 });
    expect((await request(app).get(`/api/items/${itemA}`).set(auth())).body.item.currentStock).toBe(42);
    expect((await request(app).post(`/api/import/${id}/commit`).set(auth()).send(body)).status).toBe(400);
    const cm = await request(app).post(`/api/import/${id}/commit`).set(auth()).send({ ...body, confirm: true }); expect(cm.status).toBe(200); expect(cm.body.counts.updated).toBe(1);
    expect((await request(app).get(`/api/items/${itemA}`).set(auth())).body.item.currentStock).toBe(50);
    expect((await request(app).post(`/api/import/${id}/commit`).set(auth()).send({ ...body, confirm: true })).status).toBe(409);
    expect((await request(app).post(`/api/import/logs/${id}/rollback`).set(auth())).status).toBe(200);
    expect((await request(app).get(`/api/items/${itemA}`).set(auth())).body.item.currentStock).toBe(42);
  });
  it('rejects non-spreadsheet uploads', async () => {
    expect((await request(app).post('/api/import/upload').set(auth()).field('kind', 'MASTER').attach('file', Buffer.from('MZ\x90\x00 not excel at all'), 'evil.xlsx')).status).toBe(400);
  });
  it('master import: new + existing + missing criteria shown in preview, applied on confirm', async () => {
    const up = await request(app).post('/api/import/upload').set(auth()).field('kind', 'MASTER').attach('file', xlsx([['ITEM NAME', 'OUR STOCK', 'CRITERIA'], ['TNMG 160408', 25, 120], ['NEW ITEM 1', 8, ''], ['NEW ITEM 2', 3, 40]]), 'm.xlsx');
    const body = { sheet: 0, headerRow: 0, mapping: up.body.sheets[0].suggestedMapping, options: { blankStockAsZero: true } };
    const pv = (await request(app).post(`/api/import/${up.body.importId}/preview`).set(auth()).send(body)).body.plan.summary; expect(pv).toMatchObject({ newItems: 2, existingItems: 1, missingCriteria: 1 });
    expect((await request(app).post(`/api/import/${up.body.importId}/commit`).set(auth()).send({ ...body, confirm: true })).body.counts).toMatchObject({ created: 2, updated: 1 });
    expect((await request(app).get(`/api/items?q=new item`).set(auth())).body.total).toBe(2);
    expect((await request(app).get(`/api/items/${itemB}`).set(auth())).body.item.targetStock).toBe(120);
  });
});

describe('invoice OCR workflow (never changes stock by itself)', () => {
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)]);
  it('extracts name+qty, matches against master, stock untouched until purchase is confirmed', async () => {
    setOcrProvider({ name: 'test', extract: async () => [{ rawName: 'btjnl 2525 m15', quantity: 20 }, { rawName: 'Mystery Insert', quantity: 5 }] });
    const before = (await request(app).get(`/api/items/${itemA}`).set(auth())).body.item.currentStock;
    const r = await request(app).post('/api/import/invoice').set(auth()).attach('file', png, 'invoice.png'); expect(r.status).toBe(201);
    expect(r.body.rows.map((x: any) => x.status)).toEqual(['MATCHED', 'UNMATCHED']);
    expect((await request(app).get(`/api/items/${itemA}`).set(auth())).body.item.currentStock).toBe(before);
    const c = await request(app).post('/api/purchases/bulk').set(auth()).send({ supplierId: deepak, invoiceId: r.body.invoiceId, invoiceNumber: 'INV-9', lines: [{ itemId: r.body.rows[0].itemId, quantity: 20 }] });
    expect(c.body.created).toBe(1); expect((await request(app).get(`/api/items/${itemA}`).set(auth())).body.item.currentStock).toBe(before + 20);
    setOcrProvider(null);
  });
  it('rejects dangerous file types and handles OCR being unconfigured gracefully', async () => {
    expect((await request(app).post('/api/import/invoice').set(auth()).attach('file', Buffer.from('<?php echo 1; ?>......'), 'a.php')).status).toBe(400);
    const r = await request(app).post('/api/import/invoice').set(auth()).attach('file', png, 'invoice.png'); expect(r.status).toBe(201); expect(r.body.ocrError).toMatch(/not configured/i); expect(r.body.rows).toEqual([]);
  });
});

describe('18. large transaction history stays fast', () => {
  it(`${LARGE_N} ledger rows: paginated item history, filtered ledger and dashboard stay quick`, async () => {
    const now = Date.now(); const docs = Array.from({ length: LARGE_N }, (_, i) => ({ itemId: new Types.ObjectId(itemB), type: 'ADJUSTMENT', quantity: i % 2 ? 1 : -1, balanceAfter: 20, date: new Date(now - i * 60000), createdAt: new Date(), updatedAt: new Date() }));
    for (let i = 0; i < docs.length; i += 1000) await StockTransaction.insertMany(docs.slice(i, i + 1000), { ordered: false });
    const t0 = Date.now(); const h = await request(app).get(`/api/items/${itemB}/transactions?limit=50`).set(auth()); const t1 = Date.now() - t0;
    expect(h.body.rows.length).toBe(50); expect(h.body.total).toBeGreaterThanOrEqual(LARGE_N); expect(t1).toBeLessThan(1500);
    const t2 = Date.now(); await request(app).get('/api/dashboard').set(auth()); expect(Date.now() - t2).toBeLessThan(1500);
    const t3 = Date.now(); const l = await request(app).get('/api/stock/transactions?type=ADJUSTMENT&preset=month&limit=50').set(auth()); expect(l.body.rows.length).toBeLessThanOrEqual(50); expect(Date.now() - t3).toBeLessThan(2000);
    console.log(`large ledger (${LARGE_N}): item history ${t1}ms`);
  });
  it('declares the indexes the queries rely on', async () => {
    const idx = (await StockTransaction.collection.indexes()).map((i: any) => Object.keys(i.key).join(',')); expect(idx).toContain('itemId,date,_id'); expect(idx).toContain('date,_id');
    const iidx = (await Item.collection.indexes()).map((i: any) => Object.keys(i.key).join(',')); expect(iidx).toEqual(expect.arrayContaining(['nameKey', 'searchText', 'active,status,priority']));
    void Supplier;
  });
});
