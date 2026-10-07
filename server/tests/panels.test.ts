import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { seed } from '../src/scripts/seed';
import { User } from '../src/models';

const app = createApp(); let admin = '', sales = '', sales2 = ''; let deepak = '', ashish = ''; let A = '', B = '';
const au = (t: string) => ({ Authorization: `Bearer ${t}` });
const login = async (u: string, p: string) => (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
const stock = async (id: string) => (await request(app).get(`/api/items/${id}`).set(au(admin))).body.item.currentStock;
const ymd = (n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + n * 864e5));   // company day (IST), same as the server

beforeAll(async () => {
  await mongoose.connect(config.mongoUri); await mongoose.connection.dropDatabase(); await seed();
  admin = await login('admin', 'TestAdmin123!');
  for (const [u, n] of [['ravi', 'Ravi'], ['sita', 'Sita']]) await User.create({ username: u, name: n, role: 'SALES', passwordHash: await bcrypt.hash('SalesPass123', 10) });
  sales = await login('ravi', 'SalesPass123'); sales2 = await login('sita', 'SalesPass123');
  const s = (await request(app).get('/api/suppliers').set(au(admin))).body.suppliers; deepak = s.find((x: any) => x.name === 'Deepak')._id; ashish = s.find((x: any) => x.name === 'Ashish')._id;
  const mk = async (name: string, extra: any) => (await request(app).post('/api/items').set(au(admin)).send({ special: true, name, supplierId: deepak, ...extra })).body.id;
  A = await mk('BTJNL 2525 M15', { priority: 'TOP', targetStock: 100, openingStock: 40 }); B = await mk('TNMG 160408', { targetStock: 50, openingStock: 5 });
});
afterAll(async () => { await mongoose.disconnect(); });

describe('items must exist in the list; manual add only as special item', () => {
  it('manual add without the special option says it does not exist', async () => {
    const r = await request(app).post('/api/items').set(au(admin)).send({ name: 'BRAND NEW 1' }); expect(r.status).toBe(400); expect(r.body.error).toMatch(/does not exist/i);
  });
  it('special add refused if the item already exists (even with different spacing/punctuation)', async () => {
    const r = await request(app).post('/api/items').set(au(admin)).send({ special: true, name: 'btjnl-2525  m15' }); expect(r.status).toBe(409);
    const c = (await request(app).get('/api/items/check?name=' + encodeURIComponent('BTJNL 2525 M15')).set(au(admin))).body; expect(c.exists).toBe(true);
  });
  it('a genuinely new item can be added as special and is flagged', async () => {
    const r = await request(app).post('/api/items').set(au(admin)).send({ special: true, name: 'ONE OFF TOOL 9' }); expect(r.status).toBe(201);
    expect((await request(app).get('/api/items?special=true').set(au(admin))).body.items.map((i: any) => i.name)).toContain('ONE OFF TOOL 9');
  });
  it('entries for an unknown item id are rejected', async () => {
    const r = await request(app).post('/api/entries/batch').set(au(admin)).send({ type: 'SALE', lines: [{ itemId: '5f1d7f3b9d1c2a0012345678', quantity: 1 }] }); expect(r.status).toBe(400); expect(r.body.error).toMatch(/do not exist/i);
  });
  it('fast prefix search finds by word start, and falls back to partial match', async () => {
    expect((await request(app).get('/api/sales/search?q=btj 2525').set(au(sales))).body.items.length).toBe(1);
    expect((await request(app).get('/api/sales/search?q=jnl').set(au(sales))).body.items.length).toBe(1);   // partial inside a word -> fallback
  });
});

describe('sales panel: book stock, minus from actual', () => {
  it('booking 15 of 40 leaves 25; stock never goes below 0; two bookings cannot oversell', async () => {
    const r = await request(app).post('/api/entries/batch').set(au(sales)).send({ type: 'SALE', party: 'Acme Tools', lines: [{ itemId: A, quantity: 15 }] }); expect(r.status).toBe(201); expect(r.body.lines[0].newStock).toBe(25); expect(await stock(A)).toBe(25);
    const bad = await request(app).post('/api/entries/batch').set(au(sales)).send({ type: 'SALE', lines: [{ itemId: A, quantity: 26 }] }); expect(bad.status).toBe(409); expect(bad.body.error).toMatch(/only 25 available/); expect(await stock(A)).toBe(25);
    for (let i = 0; i < 2; i++) expect((await request(app).post('/api/entries/batch').set(au(sales2)).send({ type: 'SALE', lines: [{ itemId: A, quantity: 10 }] })).status).toBe(201);
    expect(await stock(A)).toBe(5);
  });
  it('sales cannot enter purchases/rejections or use admin pages', async () => {
    expect((await request(app).post('/api/entries/batch').set(au(sales)).send({ type: 'PURCHASE', supplierId: deepak, lines: [{ itemId: A, quantity: 1 }] })).status).toBe(403);
    for (const p of ['/api/purchases', '/api/dashboard', '/api/suppliers', '/api/reorder', '/api/orders', '/api/activity', '/api/records/summary', '/api/stock/transactions']) expect((await request(app).get(p).set(au(sales))).status).toBe(403);
  });
  it('sales sees only own bookings; can cancel own (stock restored) but not someone else\'s', async () => {
    const mine = (await request(app).get('/api/entries').set(au(sales))).body; expect(mine.rows.every((r: any) => r.userName === 'Ravi')).toBe(true); expect(mine.total).toBe(1);
    const other = (await request(app).get('/api/entries').set(au(sales2))).body.rows[0];
    expect((await request(app).post(`/api/entries/${other._id}/cancel`).set(au(sales))).status).toBe(403);
    const c = await request(app).post(`/api/entries/${mine.rows[0]._id}/cancel`).set(au(sales)); expect(c.status).toBe(200); expect(await stock(A)).toBe(20);
    expect((await request(app).post(`/api/entries/${mine.rows[0]._id}/cancel`).set(au(sales))).status).toBe(409);
  });
  it('admin sees what each employee did today', async () => {
    const a = (await request(app).get('/api/activity?preset=today').set(au(admin))).body;
    const sita = a.rows.find((r: any) => r.name === 'Sita'); expect(sita.qty).toBe(20); expect(a.rows.find((r: any) => r.name === 'Ravi').qty).toBe(0);
    const e = (await request(app).get(`/api/entries?userId=${sita.userId}&preset=today`).set(au(admin))).body; expect(e.rows.length).toBe(2);
  });
});

describe('orders given to suppliers: pending + expected date for sales', () => {
  it('admin orders 100 of A (expected in 7 days); sales sees pending 100 and the date, not the supplier', async () => {
    const o = await request(app).post('/api/orders').set(au(admin)).send({ supplierId: deepak, expectedDate: ymd(7), lines: [{ itemId: A, quantity: 100 }] }); expect(o.status).toBe(201);
    const s = (await request(app).get('/api/sales/search?q=btjnl').set(au(sales))).body.items[0];
    expect(s).toMatchObject({ available: 20, pendingOrderQty: 100 }); expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(s.expectedDate))).toBe(ymd(7)); expect(JSON.stringify(s)).not.toMatch(/Deepak|supplier/i);
  });
  it('receiving from that supplier closes the order first-in-first-out; cancelling the purchase re-opens it', async () => {
    const p = await request(app).post('/api/entries/batch').set(au(admin)).send({ type: 'PURCHASE', supplierId: deepak, docNo: 'CH-77', docType: 'CHALLAN', lines: [{ itemId: A, quantity: 60 }] }); expect(p.status).toBe(201); expect(await stock(A)).toBe(80);
    expect((await request(app).get('/api/sales/search?q=btjnl').set(au(sales))).body.items[0].pendingOrderQty).toBe(40);
    const pid = (await request(app).get('/api/purchases').set(au(admin))).body.rows[0]._id; await request(app).delete(`/api/purchases/${pid}`).set(au(admin));
    expect((await request(app).get('/api/sales/search?q=btjnl').set(au(sales))).body.items[0].pendingOrderQty).toBe(100); expect(await stock(A)).toBe(20);
  });
  it('"order everything required" does not double-order what is already on order', async () => {
    await request(app).put(`/api/items/${A}`).set(au(admin)).send({ targetStock: 100 });   // level 50, stock 20 => required 80, 100 already on order
    const r = await request(app).post('/api/orders/from-reorder').set(au(admin)).send({ supplierId: deepak, expectedDate: ymd(5) });
    expect(r.status).toBe(201); expect(r.body.lines).toBe(1);   // only B (stock 5, target 50 => 45); A is fully covered
    const rr = (await request(app).get(`/api/reorder?supplierId=${deepak}`).set(au(admin))).body.rows.find((x: any) => x.name === 'BTJNL 2525 M15'); expect(rr).toMatchObject({ onOrderQty: 100, stillRequired: 0 });
  });
});

describe('purchase / challan / rejection entries (admin)', () => {
  it('rejection IN (returned by customer) adds, OUT (to supplier) subtracts and is stock-guarded', async () => {
    const before = await stock(B);
    expect((await request(app).post('/api/entries/batch').set(au(admin)).send({ type: 'REJECTION', direction: 'IN', party: 'Acme', lines: [{ itemId: B, quantity: 3 }] })).status).toBe(201); expect(await stock(B)).toBe(before + 3);
    expect((await request(app).post('/api/entries/batch').set(au(admin)).send({ type: 'REJECTION', direction: 'OUT', supplierId: deepak, lines: [{ itemId: B, quantity: 2 }] })).status).toBe(201); expect(await stock(B)).toBe(before + 1);
    expect((await request(app).post('/api/entries/batch').set(au(admin)).send({ type: 'REJECTION', direction: 'OUT', lines: [{ itemId: B, quantity: 999 }] })).status).toBe(409);
    expect((await request(app).post('/api/entries/batch').set(au(admin)).send({ type: 'REJECTION', lines: [{ itemId: B, quantity: 1 }] })).status).toBe(400);
  });
  it('Excel sales file: sales user previews, then confirms; unknown items are not booked', async () => {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Item', 'Qty'], ['TNMG 160408', 2], ['NOT IN LIST', 4]]), 'S'); const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const up = await request(app).post('/api/import/upload').set(au(sales)).field('kind', 'ENTRY').attach('file', buf, 'orders.xlsx'); expect(up.status).toBe(201);
    const body = { sheet: 0, headerRow: 0, mapping: up.body.sheets[0].suggestedMapping, entry: { type: 'SALE', party: 'Beta Co' } };
    const pv = (await request(app).post(`/api/import/${up.body.importId}/preview`).set(au(sales)).send(body)).body.plan.summary; expect(pv).toMatchObject({ matched: 1, unmatched: 1 });
    const before = await stock(B); const cm = await request(app).post(`/api/import/${up.body.importId}/commit`).set(au(sales)).send({ ...body, confirm: true }); expect(cm.status).toBe(200); expect(cm.body.counts.created).toBe(1); expect(await stock(B)).toBe(before - 2);
    const bad = await request(app).post('/api/import/upload').set(au(sales)).field('kind', 'MASTER').attach('file', buf, 'x.xlsx'); expect(bad.status).toBe(403);
  });
});

describe('date-wise records and reports', () => {
  it('summary for today and for the quarter / FY presets', async () => {
    const t = (await request(app).get('/api/records/summary?preset=today').set(au(admin))).body;
    expect(t.sold.qty).toBeGreaterThan(0); expect(t.ordered.bySupplier[0].supplier).toBe('Deepak');
    for (const p of ['yesterday', 'week', 'month', 'lastmonth', 'quarter', 'fy', 'year']) expect((await request(app).get(`/api/records/summary?preset=${p}`).set(au(admin))).status).toBe(200);
    expect((await request(app).get(`/api/records/summary?from=${ymd(-400)}&to=${ymd(-300)}`).set(au(admin))).body.sold.qty).toBe(0);
  });
  it('sales report: admin gets everyone, sales gets only own; other reports blocked for sales', async () => {
    const dl = (url: string, t: string) => request(app).get(url).set(au(t)).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
    const rows = (b: Buffer) => XLSX.utils.sheet_to_json<any[]>(XLSX.read(b, { type: 'buffer' }).Sheets['Sales Report'], { header: 1 }).slice(3);
    const all = rows((await dl('/api/reports/sales?format=xlsx&preset=today', admin)).body); const mine = rows((await dl('/api/reports/sales?format=xlsx&preset=today', sales)).body);
    expect(all.length).toBeGreaterThan(mine.length); expect(mine.every((r: any) => r[5] === 'Ravi')).toBe(true);
    expect((await request(app).get('/api/reports/current-stock').set(au(sales))).status).toBe(403);
    for (const n of ['orders', 'rejections', 'availability', 'purchases', 'current-stock']) expect((await dl(`/api/reports/${n}?format=xlsx`, admin)).status).toBe(200);
  });
});

describe('admin panel: users', () => {
  it('lists, edits and blocks users; blocked user is locked out at once', async () => {
    const l = (await request(app).get('/api/auth/users?role=SALES').set(au(admin))).body; expect(l.total).toBe(2);
    const ravi = l.users.find((u: any) => u.username === 'ravi'); expect(ravi.lastLoginAt).toBeTruthy();
    expect((await request(app).put(`/api/auth/users/${ravi._id}`).set(au(admin)).send({ name: 'Ravi Kumar' })).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(au(sales))).body.user.name).toBe('Ravi Kumar');
    await request(app).put(`/api/auth/users/${ravi._id}`).set(au(admin)).send({ active: false });
    expect((await request(app).get('/api/sales/search?q=btj').set(au(sales))).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ username: 'ravi', password: 'SalesPass123' })).status).toBe(401);
    await request(app).put(`/api/auth/users/${ravi._id}`).set(au(admin)).send({ active: true, password: 'NewPass12345' }); expect(await login('ravi', 'NewPass12345')).toBeTruthy();
  });
});

describe('concurrency: stock can never go negative', () => {
  // Needs REAL MongoDB (atomic findOneAndUpdate). Run with:  REAL_MONGO=1 npm test   (FerretDB-style emulators do not guarantee this)
  it.skipIf(!process.env.REAL_MONGO)('several people booking the last pieces at the same moment', async () => {
    const C = (await request(app).post('/api/items').set(au(admin)).send({ special: true, name: 'RACE ITEM', targetStock: 50, openingStock: 25 })).body.id;
    await Promise.all([1, 2, 3, 4].map(() => request(app).post('/api/entries/batch').set(au(sales2)).send({ type: 'SALE', lines: [{ itemId: C, quantity: 10 }] })));
    expect(await stock(C)).toBe(5);   // exactly two bookings of 10 were applied; the database guard refuses to go below zero
  });
});
