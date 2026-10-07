import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { download, qs } from '../api';
import { Empty, ErrorBox, fmtDate, fmtNum, PageHeader, Pager, PriorityBadge, Spinner, StatusBadge, useApi } from '../ui';

const CARDS = [['total', 'Total items', 'border-slate-300', {}], ['topPriority', 'Top priority', 'border-brand', { priority: 'TOP' }], ['good', 'Good', 'border-ok', { status: 'GOOD' }], ['low', 'Low stock', 'border-warn', { status: 'LOW' }],
  ['orderRequired', 'Required (order now)', 'border-bad', { status: 'ORDER_REQUIRED' }], ['outOfStock', 'Out of stock', 'border-dead', { status: 'OUT_OF_STOCK' }], ['notSet', 'Criteria not set', 'border-unset', { status: 'NOT_SET' }]] as const;

export default function Dashboard() {
  const nav = useNavigate(); const sup = useApi('/suppliers');
  const [f, setF] = useState<Record<string, string>>({}); const [page, setPage] = useState(1); const [chip, setChip] = useState('All');
  const apply = (label: string, p: Record<string, string>) => { setChip(label); setF(p); setPage(1); };
  const { data, loading, error } = useApi('/dashboard' + qs({ ...f, page, limit: 25 }));
  const chips: [string, Record<string, string>][] = [['All', {}], ['Top priority', { priority: 'TOP' }], ['Normal', { priority: 'NORMAL' }], ...((sup.data?.suppliers || []).map((s: any) => [s.name, { supplierId: s._id }]) as [string, Record<string, string>][]),
    ['Required', { status: 'ORDER_REQUIRED' }], ['Low stock', { status: 'LOW' }], ['Out of stock', { status: 'OUT_OF_STOCK' }], ['Criteria not set', { status: 'NOT_SET' }]];
  const title = chip === 'All' ? 'Items to order now' : `Items: ${chip}`;
  const c = data?.cards;
  return <>
    <PageHeader title="Dashboard" sub="Current stock position at a glance"><button className="btn" onClick={() => download('/reports/order-required' + qs({ format: 'xlsx', ...f }))}>Export Excel</button></PageHeader>
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">{CARDS.map(([k, label, border, p]) => <button key={k} onClick={() => apply(label, p as any)} className={`card text-left p-3 border-l-4 ${border} hover:bg-slate-50`}><div className="text-2xl font-semibold tabular-nums">{c ? fmtNum(c[k]) : '…'}</div><div className="text-sm text-slate-600">{label}</div></button>)}</div>
    <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="Filters">{chips.map(([l, p]) => <button key={l} onClick={() => apply(l, p)} className={`rounded-full border px-3 py-1 text-sm ${chip === l ? 'bg-brand text-white border-brand' : 'bg-white border-slate-300 hover:bg-slate-100'}`}>{l}</button>)}</div>
    <div className="card overflow-hidden"><div className="px-4 py-3 font-semibold border-b border-slate-200">{title}</div><ErrorBox msg={error} />
      {loading && !data ? <Spinner /> : !data?.rows.length ? <Empty>Nothing to show for this filter.</Empty> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Item</th><th>Supplier</th><th className="text-right">Criteria</th><th className="text-right">Available</th><th className="text-right">Required</th><th>Priority</th><th>Status</th><th>Last purchase</th></tr></thead>
        <tbody>{data.rows.map((r: any) => <tr key={r._id} className="cursor-pointer" onClick={() => nav('/items/' + r._id)}>
          <td className="font-medium"><Link to={'/items/' + r._id} onClick={e => e.stopPropagation()} className="hover:underline">{r.name}</Link></td><td>{r.supplierId?.name || <span className="text-unset">Not assigned</span>}</td>
          <td className="text-right tabular-nums">{fmtNum(r.targetStock)}</td><td className="text-right tabular-nums font-medium">{fmtNum(r.currentStock)}</td>
          <td className="text-right tabular-nums font-semibold">{r.suggestedOrderQty ? fmtNum(r.suggestedOrderQty) : '—'}</td><td><PriorityBadge p={r.priority} /></td><td><StatusBadge status={r.status} /></td><td>{fmtDate(r.lastPurchaseDate)}</td></tr>)}</tbody></table></div>}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}</div></>;
}
