import mongoose, { Schema, Types, InferSchemaType } from 'mongoose';

const opts = { timestamps: true } as const;

// ---------------- User ----------------
const userSchema = new Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['ADMIN', 'SALES'], default: 'SALES' },   // two panels: Admin and Sales
  lastLoginAt: Date,
  active: { type: Boolean, default: true },
}, opts);
export const User = mongoose.model('User', userSchema);

// ---------------- Supplier ----------------
const supplierSchema = new Schema({
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true, unique: true },
  phone: String, notes: String,
  active: { type: Boolean, default: true },
}, opts);
export const Supplier = mongoose.model('Supplier', supplierSchema);

// ---------------- Item (master record + configurable criteria + derived status) ----------------
const itemSchema = new Schema({
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true, unique: true },       // normalised upper-case name -> one record per item
  looseKey: { type: String, index: true },                       // punctuation-free key used for duplicate detection
  code: { type: String, trim: true, sparse: true, index: true },
  category: { type: String, trim: true, index: true },
  unit: { type: String, default: 'PCS' },
  priority: { type: String, enum: ['TOP', 'NORMAL'], default: 'NORMAL' },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
  altSupplierIds: [{ type: Schema.Types.ObjectId, ref: 'Supplier' }], // future: multiple suppliers per item (not in UI yet)
  active: { type: Boolean, default: true },

  // ---- criteria (admin editable). null = not configured ----
  targetStock: { type: Number, default: null, min: 0 },
  reorderLevel: { type: Number, default: null, min: 0 },          // direct level (option B)
  reorderPct: { type: Number, default: null, min: 0, max: 100 },  // per-item % (option A); null => global default

  // ---- stock ----
  currentStock: { type: Number, default: 0 },                     // maintained ONLY through stock transactions
  txnCount: { type: Number, default: 0 },
  lastPurchaseDate: Date, lastPurchaseQty: Number,

  // ---- derived by lib/stockLogic.ts, persisted so MongoDB can index/filter/aggregate ----
  status: { type: String, enum: ['GOOD', 'LOW', 'ORDER_REQUIRED', 'OUT_OF_STOCK', 'NOT_SET'], default: 'NOT_SET' },
  statusRank: { type: Number, default: 3 },                       // 0 out,1 order,2 low,3 not set,4 good  (natural sort)
  ruleUsed: { type: String, default: 'NONE' },
  effectiveReorderPct: { type: Number, default: null },
  effectiveReorderLevel: { type: Number, default: null },
  suggestedOrderQty: { type: Number, default: 0 },

  searchText: { type: String, index: true },
  tokens: { type: [String], default: [] },                        // lower-case words: indexed PREFIX search (fast at any size)
  special: { type: Boolean, default: false },                     // one-off item added by admin that is NOT in the Excel master list                      // lower-case name + code + category (+ supplier name) for fast contains-search
}, opts);
itemSchema.index({ active: 1, status: 1, priority: -1 });
itemSchema.index({ active: 1, supplierId: 1, status: 1 });
itemSchema.index({ active: 1, priority: -1, statusRank: 1, name: 1 });
itemSchema.index({ name: 1 });
itemSchema.index({ tokens: 1 });
itemSchema.index({ special: 1 }, { sparse: true });
export const Item = mongoose.model('Item', itemSchema);

// ---------------- StockTransaction (audit trail; source of truth for stock) ----------------
export const TXN_TYPES = ['OPENING_STOCK', 'PURCHASE', 'SALE', 'REJECTION', 'STOCK_OUT', 'ADJUSTMENT', 'RETURN'] as const;
const txnSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
  type: { type: String, enum: TXN_TYPES, required: true },
  quantity: { type: Number, required: true },                    // SIGNED: + increases stock, - decreases
  balanceAfter: { type: Number, required: true },
  date: { type: Date, required: true },
  reference: String,
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  purchaseId: { type: Schema.Types.ObjectId, ref: 'Purchase' },
  importId: { type: Schema.Types.ObjectId, ref: 'ImportLog' },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  userName: String,
  remarks: String,
  party: String,                                                  // customer name (sale / rejection)
  cancelled: { type: Boolean, default: false },
  reversalOf: { type: Schema.Types.ObjectId },
}, opts);
txnSchema.index({ userId: 1, date: -1 });
txnSchema.index({ type: 1, cancelled: 1, date: -1 });
txnSchema.index({ itemId: 1, date: -1, _id: -1 });
txnSchema.index({ date: -1, _id: -1 });
txnSchema.index({ type: 1, date: -1 });
txnSchema.index({ supplierId: 1, date: -1 });
txnSchema.index({ importId: 1 }, { sparse: true });
export const StockTransaction = mongoose.model('StockTransaction', txnSchema);

// ---------------- Purchase ----------------
const purchaseSchema = new Schema({
  date: { type: Date, required: true },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  quantity: { type: Number, required: true, min: 0 },
  invoiceNumber: { type: String, trim: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  remarks: String,
  docType: { type: String, enum: ['INVOICE', 'CHALLAN'], default: 'INVOICE' },
  allocations: [{ _id: false, lineId: Schema.Types.ObjectId, qty: Number }],   // which supplier-order lines this receipt closed
  status: { type: String, enum: ['ACTIVE', 'CANCELLED'], default: 'ACTIVE' },
  transactionId: { type: Schema.Types.ObjectId, ref: 'StockTransaction' },
  userId: { type: Schema.Types.ObjectId, ref: 'User' }, userName: String,
}, opts);
purchaseSchema.index({ status: 1, date: -1, _id: -1 });
purchaseSchema.index({ supplierId: 1, date: -1 });
purchaseSchema.index({ itemId: 1, date: -1 });
purchaseSchema.index({ invoiceNumber: 1 }, { sparse: true });
export const Purchase = mongoose.model('Purchase', purchaseSchema);

// ---------------- OrderLine: what admin ordered from a supplier (one row per item) ----------------
const orderLineSchema = new Schema({
  orderNo: { type: String, index: true },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  quantity: { type: Number, required: true, min: 0 }, receivedQty: { type: Number, default: 0 },
  orderDate: { type: Date, required: true }, expectedDate: { type: Date },
  status: { type: String, enum: ['OPEN', 'RECEIVED', 'CANCELLED'], default: 'OPEN' },
  remarks: String, userId: { type: Schema.Types.ObjectId, ref: 'User' }, userName: String,
}, opts);
orderLineSchema.index({ itemId: 1, status: 1, expectedDate: 1 });
orderLineSchema.index({ supplierId: 1, status: 1 });
orderLineSchema.index({ orderDate: -1 });
export const OrderLine = mongoose.model('OrderLine', orderLineSchema);

// ---------------- Invoice (file reference only; the file itself lives in storage, never in MongoDB) ----------------
const invoiceSchema = new Schema({
  originalName: String, mime: String, size: Number, storageKey: { type: String, required: true },
  status: { type: String, enum: ['UPLOADED', 'EXTRACTED', 'CONFIRMED', 'FAILED'], default: 'UPLOADED' },
  provider: String, error: String,
  extracted: [{ rawName: String, quantity: Number }],
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, opts);
export const Invoice = mongoose.model('Invoice', invoiceSchema);

// ---------------- ImportLog ----------------
const importSchema = new Schema({
  kind: { type: String, enum: ['MASTER', 'STOCK_QTY', 'ENTRY'], required: true },
  fileName: String, storageKey: String, sheetName: String,
  status: { type: String, enum: ['UPLOADED', 'APPLIED', 'ROLLED_BACK', 'FAILED'], default: 'UPLOADED' },
  userId: { type: Schema.Types.ObjectId, ref: 'User' }, userName: String,
  counts: { total: Number, created: Number, updated: Number, skipped: Number, failed: Number },
  options: Schema.Types.Mixed, mapping: Schema.Types.Mixed,
  changes: [{ _id: false, itemId: Schema.Types.ObjectId, created: Boolean, before: Schema.Types.Mixed }], // enables rollback
  appliedAt: Date, rolledBackAt: Date,
}, opts);
importSchema.index({ createdAt: -1 });
export const ImportLog = mongoose.model('ImportLog', importSchema);

// ---------------- Setting (key/value) ----------------
export const Setting = mongoose.model('Setting', new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed }, opts));

export type ItemDoc = InferSchemaType<typeof itemSchema> & { _id: Types.ObjectId };
