import { useState } from 'react';
import { download, qs } from '../api';
import { useAuth } from '../App';
import { DateFilters, dateParams, Empty, ErrorBox, ItemPicker, PageHeader, Pager, Spinner, SupplierSelect, useApi } from '../ui';

const REPORTS = [
  { key: 'sales', label: 'Sales (went out)', help: 'Everything sold / booked, with customer and who entered it.', filters: ['date'], sales: true },
  { key: 'availability', label: 'Stock availability', help: 'Available now, pending in order, expected date.', filters: ['search'], sales: true },
  { key: 'orders', label: 'Orders to suppliers', help: 'Ordered, received, pending and expected date.', filters: ['date', 'supplier'] },
  { key: 'rejections', label: 'Rejections', help: 'Customer returns and supplier rejections.', filters: ['date'] },
  { key: 'current-stock', label: 'Current stock', help: 'Every item with its stock, criteria and status.', filters: ['supplier', 'status', 'priority'] },
  { key: 'order-required', label: 'Required (order now)', help: 'Items below their reorder level, with suggested quantity.', filters: ['supplier', 'priority'] },
  { key: 'daily', label: 'Daily purchases', help: 'What was purchased, from whom, on which date.', filters: ['date', 'supplier'] },
  { key: 'supplier', label: 'Supplier-wise purchases', help: 'Totals per supplier for the chosen period.', filters: ['date', 'supplier'] },
  { key: 'transactions', label: 'Stock transactions', help: 'Complete audit trail of stock movements.', filters: ['date', 'supplier', 'item', 'type'] },
  { key: 'criteria-missing', label: 'Criteria missing', help: 'Items with no target stock or reorder level yet.', filters: ['supplier', 'priority'] },
];

export default function Reports() {
  const { isAdmin } = useAuth(); const list = isAdmin ? REPORTS : REPORTS.filter((x: any) => x.sales); const [key, setKey] = useState(isAdmin ? 'order-required' : 'sales'); const [search, setSearch] = useState(''); const r = list.find(x => x.key === key) || list[0];
  const [d, setD] = useState({ preset: 'month', from: '', to: '' }); const [supplierId, setS] = useState(''); const [status, setStatus] = useState(''); const [priority, setPri] = useState(''); const [item, setItem] = useState<any>(null); const [type, setType] = useState(''); const [page, setPage] = useState(1);
  const f: Record<string, any> = { supplierId, q: r.filters.includes('search') ? search : '' };
  if (r.filters.includes('date')) Object.assign(f, dateParams(d)); if (r.filters.includes('status')) f.status = status; if (r.filters.includes('priority')) f.priority = priority; if (r.filters.includes('item')) f.itemId = item?.id; if (r.filters.includes('type')) f.type = type;
  const { data, loading, error } = useApi(`/reports/${key}` + qs({ ...f, page, limit: 100 }));
  return <><PageHeader title="Reports" sub={r.help}><button className="btn btn-primary" onClick={() => download(`/reports/${key}` + qs({ ...f, format: 'xlsx' }), `${key}.xlsx`)}>Export Excel</button></PageHeader>
    <div className="flex flex-wrap gap-1.5 mb-3">{list.map(x => <button key={x.key} onClick={() => { setKey(x.key); setPage(1); }} className={`rounded-full border px-3 py-1 text-sm ${key === x.key ? 'bg-brand text-white border-brand' : 'bg-white border-slate-300 hover:bg-slate-100'}`}>{x.label}</button>)}</div>
    <div className="card p-3 mb-3 flex flex-wrap gap-2 items-center">
      {r.filters.includes('search') && <input className="inp !w-64" placeholder="Search item…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />}
      {r.filters.includes('date') && <DateFilters v={d} set={(x: any) => { setD(x); setPage(1); }} />}
      {r.filters.includes('supplier') && <SupplierSelect className="inp !w-auto" value={supplierId} onChange={v => { setS(v); setPage(1); }} includeAll="All suppliers" includeNone={key !== 'daily' && key !== 'supplier' && key !== 'transactions'} />}
      {r.filters.includes('status') && <select className="inp !w-auto" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option value="GOOD">Good</option><option value="LOW">Low stock</option><option value="ORDER_REQUIRED">Order required</option><option value="OUT_OF_STOCK">Out of stock</option><option value="NOT_SET">Criteria not set</option></select>}
      {r.filters.includes('priority') && <select className="inp !w-auto" value={priority} onChange={e => { setPri(e.target.value); setPage(1); }}><option value="">All priorities</option><option value="TOP">Top priority</option><option value="NORMAL">Normal</option></select>}
      {r.filters.includes('type') && <select className="inp !w-auto" value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="">All types</option>{['OPENING_STOCK', 'PURCHASE', 'STOCK_OUT', 'ADJUSTMENT', 'RETURN'].map(t => <option key={t} value={t}>{t.replace('_', ' ').toLowerCase()}</option>)}</select>}
      {r.filters.includes('item') && <div className="w-64"><ItemPicker value={item} onPick={i => { setItem(i); setPage(1); }} placeholder="Filter by item…" /></div>}</div>
    <ErrorBox msg={error} />
    <div className="card overflow-hidden">{loading && !data ? <Spinner /> : !data?.rows.length ? <Empty>No data for these filters.</Empty> : <div className="overflow-x-auto"><table className="tbl"><thead><tr>{data.columns.map((c: any) => <th key={c.key} className={c.type === 'number' ? 'text-right' : ''}>{c.header}</th>)}</tr></thead>
      <tbody>{data.rows.map((row: any, i: number) => <tr key={i}>{data.columns.map((c: any) => <td key={c.key} className={c.type === 'number' ? 'text-right tabular-nums' : ''}>{row[c.key] ?? ''}</td>)}</tr>)}</tbody></table></div>}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}</div></>;
}
