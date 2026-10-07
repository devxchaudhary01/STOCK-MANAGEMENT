import { useState } from 'react';
import { download, qs } from '../api';
import { DateFilters, dateParams, Empty, ErrorBox, fmtDate, fmtNum, PageHeader, Spinner, useApi } from '../ui';

/** Any date / month / quarter / financial year / custom range: how much went out, came in, which supplier was ordered how much. */
export default function Records() {
  const [d, setD] = useState({ preset: 'month', from: '', to: '' }); const f = dateParams(d); const { data, loading, error } = useApi('/records/summary' + qs(f));
  const range = data?.range ? `${fmtDate(data.range.from)} to ${fmtDate(new Date(new Date(data.range.to).getTime() - 1).toISOString())}` : 'All time';
  const Card = ({ l, v, sub, c }: { l: string; v: any; sub?: string; c: string }) => <div className={`card p-4 border-l-4 ${c}`}><div className="text-sm text-slate-600">{l}</div><div className="text-3xl font-semibold tabular-nums">{fmtNum(v)}</div>{sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}</div>;
  const Sup = ({ title, rows }: { title: string; rows: any[] }) => <div className="card overflow-hidden"><div className="px-4 py-3 font-semibold border-b border-slate-200">{title}</div>{!rows?.length ? <Empty>Nothing in this period.</Empty> : <table className="tbl"><thead><tr><th>Supplier</th><th className="text-right">Lines</th><th className="text-right">Quantity</th></tr></thead><tbody>{rows.map((r: any) => <tr key={String(r.supplierId)}><td className="font-medium">{r.supplier}</td><td className="text-right">{fmtNum(r.lines)}</td><td className="text-right tabular-nums">{fmtNum(r.qty)}</td></tr>)}</tbody></table>}</div>;
  const dl = (name: string, label: string) => <button key={name} className="btn" onClick={() => download(`/reports/${name}` + qs({ ...f, format: 'xlsx' }), `${name}.xlsx`)}>⬇ {label}</button>;
  return <><PageHeader title="Date-wise records" sub={`Showing: ${range}`} />
    <div className="card p-3 mb-4 flex flex-wrap gap-2 items-center"><DateFilters v={d} set={setD} /></div><ErrorBox msg={error} />
    {loading && !data ? <Spinner /> : data && <><div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4"><Card c="border-bad" l="Went out (sold)" v={data.sold.qty} sub={`${fmtNum(data.sold.lines)} sale lines`} /><Card c="border-ok" l="Came in (purchased)" v={data.received.qty} sub={`${fmtNum(data.received.lines)} purchase lines`} />
      <Card c="border-brand" l="Ordered from suppliers" v={data.ordered.qty} sub={`${fmtNum(data.ordered.lines)} order lines`} /><Card c="border-warn" l="Rejections" v={data.rejections.returnedIn + data.rejections.sentOut} sub={`${fmtNum(data.rejections.returnedIn)} returned in · ${fmtNum(data.rejections.sentOut)} sent out`} /></div>
      <div className="grid gap-4 xl:grid-cols-2 mb-4"><Sup title="Ordered: which supplier, how much" rows={data.ordered.bySupplier} /><Sup title="Received: which supplier, how much" rows={data.received.bySupplier} /></div>
      <div className="card p-4"><h2 className="font-semibold mb-2">Download this period</h2><div className="flex flex-wrap gap-2">{dl('sales', 'Sales (went out)')}{dl('purchases', 'Purchases / challans (came in)')}{dl('orders', 'Orders to suppliers')}{dl('rejections', 'Rejections')}{dl('transactions', 'Full stock ledger')}</div></div></>}</>;
}
