const BASE = (import.meta.env.VITE_API_URL as string) || '/api';
export const getToken = () => localStorage.getItem('ssct_token');
export const setToken = (t: string | null) => (t ? localStorage.setItem('ssct_token', t) : localStorage.removeItem('ssct_token'));

async function req(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as any) }; const t = getToken(); if (t) headers.Authorization = `Bearer ${t}`;
  if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { ...init, headers });
  if (res.status === 401 && !path.startsWith('/auth/login')) { setToken(null); window.dispatchEvent(new Event('ssct-logout')); }
  if (!res.ok) { let msg = `Request failed (${res.status})`; try { msg = (await res.json()).error || msg; } catch { /* not json */ } throw new Error(msg); }
  return res;
}
const json = async (p: string, init?: RequestInit) => (await req(p, init)).json();
export const api = {
  get: (p: string) => json(p),
  post: (p: string, b?: unknown) => json(p, { method: 'POST', body: JSON.stringify(b ?? {}) }),
  put: (p: string, b?: unknown) => json(p, { method: 'PUT', body: JSON.stringify(b ?? {}) }),
  del: (p: string) => json(p, { method: 'DELETE' }),
  upload: (p: string, fd: FormData) => json(p, { method: 'POST', body: fd }),
};
/** Query-string builder that drops empty values. */
export const qs = (o: Record<string, any>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v)); const s = u.toString(); return s ? '?' + s : ''; };
/** Authenticated file download (Excel exports, invoice files). */
export async function download(path: string, fallbackName = 'download.xlsx', open = false) {
  const res = await req(path); const blob = await res.blob(); const url = URL.createObjectURL(blob);
  if (open) { window.open(url, '_blank'); return; }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
