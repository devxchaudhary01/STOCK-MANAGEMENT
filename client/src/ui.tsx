import { ReactNode, useEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { api } from './api';

export const STATUS: Record<string, { label: string; cls: string }> = {
  GOOD: { label: 'Good', cls: 'bg-ok text-white' },
  LOW: { label: 'Low stock', cls: 'bg-warn text-slate-900' },
  ORDER_REQUIRED: { label: 'Required', cls: 'bg-bad text-white' },
  OUT_OF_STOCK: { label: 'Out of stock', cls: 'bg-dead text-white' },
  NOT_SET: { label: 'Criteria not set', cls: 'bg-unset text-white' },
};
export const Beacon = ({ kind }: { kind: 'out' | 'order' }) => <span aria-hidden className={`beacon beacon-${kind}`} />;
/** Out of stock / Order required show a blinking light (ambulance style) instead of a plain label. Good / low / not set stay as calm pills. */
export const StatusBadge = ({ status }: { status: string }) => {
  if (status === 'OUT_OF_STOCK') return <span className="inline-flex items-center gap-2 text-xs font-bold text-dead whitespace-nowrap"><Beacon kind="out" />Out of stock</span>;
  if (status === 'ORDER_REQUIRED') return <span className="inline-flex items-center gap-2 text-xs font-bold text-bad whitespace-nowrap"><Beacon kind="order" />Required</span>;
  const s = STATUS[status] || STATUS.NOT_SET; return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${s.cls}`}>{s.label}</span>;
};
export const PriorityBadge = ({ p }: { p: string }) => p === 'TOP' ? <span className="rounded bg-brand text-white px-2 py-0.5 text-xs font-semibold whitespace-nowrap">Top priority</span> : <span className="text-xs text-slate-500">Normal</span>;
export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).replace(/ /g, '-') : '—');
export const fmtNum = (n: any) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-IN'));
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** Fetch hook: reloads when `path` changes; ignores stale responses. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null); const [loading, setLoading] = useState(!!path); const [error, setError] = useState(''); const [tick, setTick] = useState(0);
  useEffect(() => { if (!path) return; let alive = true; setLoading(true); setError('');
    api.get(path).then(d => alive && setData(d)).catch(e => alive && setError(e.message)).finally(() => alive && setLoading(false)); return () => { alive = false; }; }, [path, tick]);
  return { data, loading, error, reload: () => setTick(t => t + 1) };
}
export function useDebounced<T>(v: T, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

// ---- toast ----
const ToastCtx = createContext<(m: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ m: string; kind: string } | null>(null);
  const show = useCallback((m: string, kind: 'ok' | 'err' = 'ok') => { setT({ m, kind }); setTimeout(() => setT(null), 4500); }, []);
  return <ToastCtx.Provider value={show}>{children}{t && <div role="status" className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-md px-4 py-3 text-sm shadow-lg text-white ${t.kind === 'err' ? 'bg-bad' : 'bg-ink'}`}>{t.m}</div>}</ToastCtx.Provider>;
}

export const Spinner = () => <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
export const ErrorBox = ({ msg }: { msg: string }) => msg ? <div className="rounded-md border border-red-200 bg-red-50 text-red-800 text-sm px-3 py-2 my-2">{msg}</div> : null;
export const Empty = ({ children }: { children: ReactNode }) => <div className="py-10 text-center text-sm text-slate-500">{children}</div>;

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-3 mb-4"><div><h1 className="text-xl font-semibold">{title}</h1>{sub && <p className="text-sm text-slate-500 mt-0.5">{sub}</p>}</div><div className="flex flex-wrap gap-2">{children}</div></div>;
}
export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-100 text-sm text-slate-600">
    <span>{fmtNum(total)} {total === 1 ? 'row' : 'rows'}</span>
    <div className="flex items-center gap-2"><button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page} of {Math.max(pages, 1)}</span><button className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div></div>;
}
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div role="dialog" aria-label={title} className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} mt-10 shadow-xl`}><div className="flex items-center justify-between px-4 py-3 border-b border-slate-200"><h2 className="font-semibold">{title}</h2><button aria-label="Close" className="text-slate-500 hover:text-ink text-xl leading-none" onClick={onClose}>×</button></div><div className="p-4">{children}</div></div></div>;
}
export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => <label className="block text-sm"><span className="block mb-1 font-medium text-slate-700">{label}</span>{children}{hint && <span className="block mt-1 text-xs text-slate-500">{hint}</span>}</label>;

/** Searchable item picker backed by the indexed /items/lookup endpoint. */
export function ItemPicker({ value, onPick, placeholder = 'Search item name or code…' }: { value?: { id: string; name: string } | null; onPick: (i: any | null) => void; placeholder?: string }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q, 250); const [res, setRes] = useState<any[]>([]); const [open, setOpen] = useState(false); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (dq.trim().length < 2) { setRes([]); return; } let a = true; api.get('/items/lookup?q=' + encodeURIComponent(dq)).then(d => a && setRes(d.items)).catch(() => {}); return () => { a = false; }; }, [dq]);
  useEffect(() => { const h = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  if (value) return <div className="flex items-center justify-between gap-2 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white"><span className="truncate font-medium">{value.name}</span><button type="button" className="text-slate-500 hover:text-bad" onClick={() => onPick(null)}>Change</button></div>;
  return <div ref={box} className="relative"><input className="inp" value={q} placeholder={placeholder} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
    {open && res.length > 0 && <ul className="absolute z-30 mt-1 w-full max-h-64 overflow-auto card shadow-lg">{res.map(i => <li key={i._id}><button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-brand-soft flex justify-between gap-2" onClick={() => { onPick({ id: i._id, name: i.name, ...i }); setOpen(false); setQ(''); }}><span>{i.name}</span><span className="text-slate-500 whitespace-nowrap">Stock {i.currentStock}{i.supplierId?.name ? ` · ${i.supplierId.name}` : ''}</span></button></li>)}</ul>}
    {open && dq.trim().length >= 2 && res.length === 0 && <div className="absolute z-30 mt-1 w-full card shadow-lg px-3 py-2 text-sm text-bad font-medium">Does not exist in the item list</div>}</div>;
}
export function SupplierSelect({ value, onChange, includeAll, includeNone, className = 'inp' }: { value: string; onChange: (v: string) => void; includeAll?: string; includeNone?: boolean; className?: string }) {
  const { data } = useApi('/suppliers');
  return <select className={className} value={value} onChange={e => onChange(e.target.value)}>{includeAll && <option value="">{includeAll}</option>}{includeNone && <option value="none">No supplier assigned</option>}{data?.suppliers?.map((s: any) => <option key={s._id} value={s._id}>{s.name}</option>)}</select>;
}
export const DateFilters = ({ v, set }: { v: { preset: string; from: string; to: string }; set: (x: any) => void }) => <>
  <select className="inp !w-auto" value={v.preset} onChange={e => set({ ...v, preset: e.target.value })}>{[['', 'All dates'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This quarter'], ['fy', 'This financial year'], ['year', 'This year'], ['custom', 'Custom range']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
  {v.preset === 'custom' && <><input type="date" className="inp !w-auto" value={v.from} onChange={e => set({ ...v, from: e.target.value })} aria-label="From date" /><input type="date" className="inp !w-auto" value={v.to} onChange={e => set({ ...v, to: e.target.value })} aria-label="To date" /></>}</>;
export const dateParams = (v: { preset: string; from: string; to: string }) => v.preset === 'custom' ? { from: v.from, to: v.to } : { preset: v.preset };

import { Lang, listen, parseVoice, speak as say, voiceSupported, Heard } from './voice';
export { say, parseVoice };
export type { Heard };
/** Microphone: tap, speak, get text. Language switch English/Hindi. Hidden if the browser has no speech support. */
export function VoiceButton({ onHeard, label = 'Speak', lang = 'en-IN' }: { onHeard: (text: string) => void; label?: string; lang?: Lang }) {
  const [on, setOn] = useState(false); const [msg, setMsg] = useState(''); const stop = useRef<null | (() => void)>(null);
  if (!voiceSupported) return null;
  const toggle = () => { if (on) { stop.current?.(); setOn(false); return; } setMsg(''); setOn(true); stop.current = listen(lang, t => onHeard(t), () => setOn(false), m => { setMsg(m); setOn(false); }); };
  return <span className="inline-flex items-center gap-2"><button type="button" onClick={toggle} aria-pressed={on} className={`btn ${on ? 'mic-live' : ''}`} title="Speak">🎤 {on ? 'Listening…' : label}</button>{msg && <span className="text-xs text-bad">{msg}</span>}</span>;
}
