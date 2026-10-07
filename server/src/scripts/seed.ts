/** Idempotent: creates indexes, the first ADMIN user, the 3 starting suppliers and default stock settings. Safe to run repeatedly. */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { User, Supplier, Item, StockTransaction, Purchase, Setting, OrderLine } from '../models';
import { searchFields, bulkUpdate } from '../services/stock';
import { normKey } from '../lib/matching';
import { DEFAULT_SETTINGS } from '../lib/stockLogic';

export async function seed() {
  await Promise.all([User, Supplier, Item, StockTransaction, Purchase, OrderLine].map(m => m.syncIndexes()));
  const stale = await Item.find({ 'tokens.0': { $exists: false } }, 'name code category').populate('supplierId', 'name').lean();   // backfill fast-search words on older data
  if (stale.length) { await bulkUpdate(stale.map((i: any) => ({ updateOne: { filter: { _id: i._id }, update: { $set: searchFields(i.name, i.code, i.category, i.supplierId?.name) } } }))); console.log(`Backfilled search words for ${stale.length} items`); }
  if (config.authRequired && !(await User.exists({ username: config.admin.username.toLowerCase() }))) {
    if (!config.admin.password || config.admin.password.length < 8) throw new Error('Set ADMIN_PASSWORD (min 8 chars) in .env before first run');
    await User.create({ username: config.admin.username, name: config.admin.name, role: 'ADMIN', passwordHash: await bcrypt.hash(config.admin.password, 12) });
    console.log(`Created admin user "${config.admin.username}"`);
  }
  for (const name of ['Deepak', 'Ashish', 'Meenu']) await Supplier.updateOne({ nameKey: normKey(name) }, { $setOnInsert: { name, nameKey: normKey(name), active: true } }, { upsert: true });
  await Setting.updateOne({ key: 'stock' }, { $setOnInsert: { value: DEFAULT_SETTINGS } }, { upsert: true });
  console.log('Seed complete: indexes, ' + (config.authRequired ? 'admin user, ' : '(login disabled) ') + 'suppliers (Deepak, Ashish, Meenu), default settings.');
}
if (require.main === module) mongoose.connect(config.mongoUri).then(seed).then(() => mongoose.disconnect()).catch(e => { console.error(e.message); process.exit(1); });
