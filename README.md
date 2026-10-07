# SSCT Stock Management

Internal stock system for SS Cutting Tools India with two panels: **Admin** (full control) and **Sales** (stock, booking, own reports).
Highlights: item list from Excel (unknown items are refused; one-off items only via *Add special item*) · simple Criteria / Available / Required · blinking ambulance-style light for out-of-stock and required items · daily entry of sale, purchase/challan and rejection by typing, voice, Excel or photo · supplier orders with expected dates shown to sales · team activity · date-wise records (day/month/quarter/FY/custom) · every report downloadable.
**Stack:** React + Vite + Tailwind (client) · Node + Express + TypeScript (server) · MongoDB · SheetJS/ExcelJS · pluggable OCR.

```
ssct-stock/
├─ client/                 React app (pages: Dashboard, Items, Stock, Purchases, Suppliers, Reorder, Reports, Import, Settings)
├─ server/
│  ├─ src/lib/stockLogic.ts        <- THE stock rules (single source of truth)
│  ├─ src/lib/importPlanner.ts     <- Excel preview / duplicate detection (no DB access, fully unit-tested)
│  ├─ src/lib/matching.ts          <- name normalisation + fuzzy matching (imports + OCR)
│  ├─ src/lib/ocr/                 <- OCR provider abstraction (anthropic | mock | none)
│  ├─ src/models/index.ts          <- User, Supplier, Item, StockTransaction, Purchase, Invoice, ImportLog, Setting
│  ├─ src/services/                <- stock transactions, imports + rollback, settings
│  ├─ src/routes/                  <- REST API
│  ├─ src/scripts/                 <- seed.ts, importInitial.ts
│  └─ tests/                       <- 76 tests (stock rules, import, voice, API, panels)
├─ data/                   your two original Excel files
└─ scripts/backup.sh
```

## Install and run locally
Requirements: Node 20+, MongoDB 6+ running locally (or an Atlas URI).
```bash
npm run install:all
cp server/.env.example server/.env        # edit ADMIN_PASSWORD and JWT_SECRET
npm run seed                              # indexes + admin user + suppliers Deepak/Ashish/Meenu + default rules
npm run dev:server                        # API on http://localhost:4000
npm run dev:client                        # App on http://localhost:5173
```
Log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`, then change the password in Settings.

## Load your two Excel files
**Recommended (visual, with duplicate review):** log in → **Import / Export → Master data**.
1. Upload `data/STOCK_CRITERIA.xlsx`, pick sheet **Sheet3**. Map `ITEM NAME → Item name`, `NK SIR CRITERIA → Target stock`. **Leave “Current stock” unmapped** (that column is the stale 22-June stock). Tick **Mark every row as top priority**. Preview → Confirm. (158 items.)
2. Upload `data/SALES_01-07_TO_30-09.xlsx`. Map `ITEM → Item name`, `QTY → Current stock`. Keep both other ticks on. Preview.
3. **Review “Needs your decision” and “Similar names”.** The 17 priority items with older spellings (e.g. `SNR 16 Q16` vs `SNR 0016 Q16`) will show *Same as: …* suggestions. Choose the right one so the priority item and its stock are one record instead of two. The two `Ø` near-duplicates also appear here.
4. Confirm. The import can be undone from **Import history**.

**Command line alternative:** `cd server && npm run import:initial -- --criteria ../data/STOCK_CRITERIA.xlsx --stock ../data/SALES_01-07_TO_30-09.xlsx` (dry run) then add `--apply`. This auto-creates the 17 legacy items as separate records, so the app route above is better.

**Assumptions in the second file:** `QTY` = current stock as of 30-Sep, blank = 0. Both are switchable in the wizard.
Normal items have no target yet → status *Criteria not set* until an admin sets one (Items → Edit). Default 50% applies automatically as soon as a target is entered.

## How stock status works (server/src/lib/stockLogic.ts)
| Situation | Result |
|---|---|
| No target and no reorder level | **Criteria not set** (orange). Never auto-ordered |
| Stock ≤ 0 | **Out of stock** (dark red) |
| Stock < reorder level | **Order required** (red). Suggested = target − stock |
| Stock = reorder level | **Low** (yellow) by default; switchable to Order required in Settings |
| Stock within 10% above level | **Low** (yellow). The band is a Setting |
| Otherwise | **Good** (green) |

Reorder level comes from, in order: the item's **direct level** → its **own %** × target → the **default %** (Settings, 50) × target. Odd results round up (25 × 50% = 13). Negative stock counts as 0 for ordering.

## Data model decisions
* **Stock transactions are the source of truth.** `Item.currentStock` is changed only through `applyTransaction()` (atomic `$inc` + ledger row with `balanceAfter`). Settings → Data checks compares stock with the ledger and can repair it.
* Status, reorder level and suggested qty are **stored on the item** (derived by one function) so MongoDB can filter, sort and count them with indexes. Changing rules in Settings recalculates all items.
* `Item.altSupplierIds` is reserved for several suppliers per item later (no UI yet).
* Invoices are stored on disk (`StockTransaction.invoiceId` / `Purchase.invoiceId` hold references); MongoDB never holds files.
* Supplier is a collection; add / rename / deactivate on the Suppliers page.

## Invoice OCR
Set in `server/.env`: `OCR_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=...` (server only, never in the frontend). Import / Export → Invoice: upload JPG/PNG/WEBP/PDF → extracted *item name + quantity* → matched against the master list (green *Matched*, amber *Check match*, red *Unmatched*) → you fix lines → **Confirm** creates purchases. Nothing changes stock before that click. To use another provider, implement `OcrProvider` in `server/src/lib/ocr/index.ts` (one method: `extract(file) → [{rawName, quantity}]`). `OCR_PROVIDER=none` disables it; lines can still be typed by hand.

## Panels and roles
`ADMIN` sees everything (Users page: list, edit, block). `SALES` can: search stock, see available / pending-in-order / expected date, book sales (typing, voice, Excel, photo), cancel own booking the same day, download own sales + availability reports. Sales cannot see suppliers, criteria, purchases or other people's entries. Blocking takes effect immediately.
Set `AUTH_REQUIRED=false` only for single-user use (no login; everyone acts as Admin and the panels are not separated).

## Voice
Uses the browser's built-in speech recognition and speech output (Chrome, Edge, Android Chrome; needs HTTPS or localhost; no API key). English or Hindi. Say `btjnl 2525 m16` -> it shows and reads out availability and pending order; then `15 piece book` or `book 15` -> books. A number counts as a quantity only when followed by *piece/pcs/nos*, after *book*, or when it is the only thing said, because item codes contain numbers. Recognition of model codes is not perfect: always check the item shown before booking.

## Speed and size
Server-side paging and indexes everywhere; item search is an indexed word-prefix search (falls back to contains); dashboard numbers come from one aggregation; sessions are cached 15 s; transactions are indexed by item, date, type and user. Excel export is capped at 100,000 rows per file (use a narrower date range beyond that).

## Tests
```bash
cd server && npm test                         # needs MongoDB on 127.0.0.1 (uses database ssct_stock_test, which it DROPS)
TEST_MONGODB_URI=mongodb://.../ssct_test npm test
LARGE_N=100000 npm test                       # ledger volume test
REAL_MONGO=1 npm test                         # also runs the concurrent-booking test (needs real MongoDB, not an emulator)
```
Unit tests (no DB): stock rules, planner, OCR matching, Excel export, **your real files**. Integration tests: auth, roles, injection, purchases, ledger, supplier filters, exports, imports + rollback, OCR flow, large ledger.
