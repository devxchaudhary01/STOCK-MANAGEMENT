import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download, qs } from '../api';
import { useAuth } from '../App';
import { DateFilters, dateParams, Empty, ErrorBox, fmtDate, fmtNum, ItemPicker, PageHeader, Pager, Spinner, SupplierSelect, useApi, useToast } from '../ui';
import { StockMoveForm } from './Items';

export default function Stock() {
  const { isAdmin } = useAuth(); const toast = useToast();
  const [type, setType] = useState(''); const [d, setD] = useState({ preset: 'month', from: '', to: '' }); const [item, setItem] = useState<any>(null); const [supplierId, setS] = useState(''); const [page, setPage] = useState(1);
  const f = { type, itemId: item?.id, supplierId, ...dateParams(d) };
  const { data, loading, error, reload } = useApi('/stock/transactions' + qs({ ...f, page, limit: 50 }));
  const reconcile = async () => { try { const r = await api.post('/stock/reconcile'); toast(r.drift.length ? `${r.drift.length} item(s) differ from the ledger. Open Settings > Data checks to repair.` : `Ledger check passed (${r.checked} items)`, r.drift.length ? 'err' : 'ok'); } catch (e: any) { toast(e.message, 'err'); } };
  return <>
    <PageHeader title="Stock" sub="Every change to stock is recorded here — this is the audit trail"><button className="btn" onClick={() => download('/reports/transactions' + qs({ ...f, format: 'xlsx' }))}>Export Excel</button>{isAdmin && <button className="btn" onClick={reconcile}>Check ledger</button>}<Link className="btn btn-primary" to="/entry">Daily entry</Link></PageHeader>
    <div className="card p-4 mb-4"><h2 className="font-semibold mb-3">Record a stock movement</h2><StockMoveForm onDone={reload} /><p className="text-xs text-slate-500 mt-2">Purchases are recorded on the Purchases page. Bulk updates from Excel are under Import / Export.</p></div>
    <div className="card p-3 mb-3 flex flex-wrap gap-2 items-center">
      <select className="inp !w-auto" value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="">All types</option>{['OPENING_STOCK', 'PURCHASE', 'STOCK_OUT', 'ADJUSTMENT', 'RETURN'].map(t => <option key={t} value={t}>{t.replace('_', ' ').toLowerCase()}</option>)}</select>
      <DateFilters v={d} set={(x: any) => { setD(x); setPage(1); }} /><div className="w-64"><ItemPicker value={item} onPick={i => { setItem(i); setPage(1); }} placeholder="Filter by item…" /></div><SupplierSelect className="inp !w-auto" value={supplierId} onChange={v => { setS(v); setPage(1); }} includeAll="All suppliers" /></div>
    <ErrorBox msg={error} />
    <div className="card overflow-hidden">{loading && !data ? <Spinner /> : !data?.rows.length ? <Empty>No transactions for these filters.</Empty> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Date</th><th>Type</th><th>Item</th><th>Supplier</th><th className="text-right">Change</th><th className="text-right">Balance</th><th>Reference</th><th>User</th><th>Remarks</th></tr></thead>
      <tbody>{data.rows.map((t: any) => <tr key={t._id}><td className="whitespace-nowrap">{fmtDate(t.date)}</td><td>{t.type.replace('_', ' ').toLowerCase()}</td><td className="font-medium">{t.itemId ? <Link className="hover:underline" to={'/items/' + t.itemId._id}>{t.itemId.name}</Link> : '—'}</td><td>{t.supplierId?.name || '—'}</td>
        <td className={`text-right tabular-nums font-medium ${t.quantity < 0 ? 'text-bad' : 'text-ok'}`}>{t.quantity > 0 ? '+' : ''}{fmtNum(t.quantity)}</td><td className="text-right tabular-nums">{fmtNum(t.balanceAfter)}</td><td>{t.reference || '—'}</td><td>{t.userName}</td><td className="max-w-[18rem] truncate" title={t.remarks}>{t.remarks}</td></tr>)}</tbody></table></div>}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}</div></>;
}
