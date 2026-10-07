import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from './api';
import { Spinner, ToastProvider } from './ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { Items, ItemDetail } from './pages/Items';
import SalesHome from './pages/SalesHome';
// less-used pages are code-split so first load stays fast on phones
const Entry = lazy(() => import('./pages/Entry'));
const Stock = lazy(() => import('./pages/Stock'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Orders = lazy(() => import('./pages/Orders'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Reorder = lazy(() => import('./pages/Suppliers').then(m => ({ default: m.Reorder })));
const SupplierDetail = lazy(() => import('./pages/Suppliers').then(m => ({ default: m.SupplierDetail })));
const Records = lazy(() => import('./pages/Records'));
const Activity = lazy(() => import('./pages/Activity'));
const Reports = lazy(() => import('./pages/Reports'));
const Import = lazy(() => import('./pages/Import'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));

export interface User { id: string; username: string; name: string; role: 'ADMIN' | 'SALES' }
const AuthCtx = createContext<{ user: User; logout: () => void; isAdmin: boolean; authRequired: boolean }>(null as any);
export const useAuth = () => useContext(AuthCtx);

const ADMIN_NAV = [['/dashboard', 'Dashboard'], ['/items', 'Items'], ['/entry', 'Daily entry'], ['/orders', 'Supplier orders'], ['/reorder', 'Reorder'], ['/suppliers', 'Suppliers'], ['/records', 'Date-wise records'], ['/activity', 'Team activity'], ['/reports', 'Reports'], ['/stock', 'Stock ledger'], ['/purchases', 'Purchase history'], ['/import', 'Import Excel'], ['/users', 'Users'], ['/settings', 'Settings']];
const SALES_NAV = [['/book', 'Stock & book'], ['/entry', 'Book by Excel / photo'], ['/reports', 'My reports']];

function Shell({ user, logout, authRequired }: { user: User; logout: () => void; authRequired: boolean }) {
  const [open, setOpen] = useState(false); const nav = user.role === 'ADMIN' ? ADMIN_NAV : SALES_NAV;
  return <AuthCtx.Provider value={{ user, logout, authRequired, isAdmin: user.role === 'ADMIN' }}>
    <div className="min-h-screen md:flex">
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between bg-brand text-white px-4 py-3"><b>SSCT · {user.role === 'ADMIN' ? 'Admin' : 'Sales'}</b><button className="btn !bg-transparent !text-white !border-white/40" onClick={() => setOpen(o => !o)} aria-expanded={open}>Menu</button></header>
      <aside className={`${open ? 'block' : 'hidden'} md:block md:w-56 shrink-0 bg-brand text-white md:min-h-screen md:sticky md:top-0 md:self-start md:max-h-screen md:overflow-y-auto`}>
        <div className="hidden md:block px-5 py-5 border-b border-white/10"><div className="font-semibold text-lg leading-tight">SS Cutting Tools</div><div className="text-xs text-white/60">{user.role === 'ADMIN' ? 'Admin panel' : 'Sales panel'}</div></div>
        <nav className="p-2 space-y-0.5">{nav.map(([to, label]) => <NavLink key={to} to={to} onClick={() => setOpen(false)} className={({ isActive }) => `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-white/15 font-semibold' : 'hover:bg-white/10 text-white/85'}`}>{label}</NavLink>)}</nav>
        {authRequired && <div className="p-4 mt-2 border-t border-white/10 text-sm"><div className="font-medium truncate">{user.name}</div><div className="text-white/60 text-xs mb-2">{user.role === 'ADMIN' ? 'Administrator' : 'Sales'}</div><button className="text-white/80 hover:text-white underline" onClick={logout}>Log out</button></div>}
      </aside>
      <main className="flex-1 min-w-0 p-3 sm:p-4 md:p-6 max-w-[1500px]"><Suspense fallback={<Spinner />}><Outlet /></Suspense></main>
    </div></AuthCtx.Provider>;
}

export default function App() {
  const nav = useNavigate(); const [user, setUser] = useState<User | null>(null); const [ready, setReady] = useState(false); const [authRequired, setAuthRequired] = useState(true);
  useEffect(() => {
    api.get('/auth/config').then(async cfg => {
      setAuthRequired(cfg.authRequired);
      if (!cfg.authRequired || getToken()) { try { setUser((await api.get('/auth/me')).user); } catch { setToken(null); } }
    }).catch(() => {}).finally(() => setReady(true));
  }, []);
  useEffect(() => { const h = () => { setUser(null); nav('/login'); }; window.addEventListener('ssct-logout', h); return () => window.removeEventListener('ssct-logout', h); }, [nav]);
  const logout = () => { setToken(null); setUser(null); nav('/login'); };
  if (!ready) return <Spinner />;
  const home = user?.role === 'SALES' ? '/book' : '/dashboard';
  return <ToastProvider><Routes>
    <Route path="/login" element={user ? <Navigate to={home} replace /> : <Login onLogin={u => { setUser(u); nav(u.role === 'SALES' ? '/book' : '/dashboard'); }} />} />
    {user && user.role === 'ADMIN' && <Route element={<Shell user={user} logout={logout} authRequired={authRequired} />}>
      <Route path="/dashboard" element={<Dashboard />} /><Route path="/items" element={<Items />} /><Route path="/items/:id" element={<ItemDetail />} /><Route path="/entry" element={<Entry />} />
      <Route path="/orders" element={<Orders />} /><Route path="/reorder" element={<Reorder />} /><Route path="/suppliers" element={<Suppliers />} /><Route path="/suppliers/:id" element={<SupplierDetail />} />
      <Route path="/records" element={<Records />} /><Route path="/activity" element={<Activity />} /><Route path="/reports" element={<Reports />} /><Route path="/stock" element={<Stock />} />
      <Route path="/purchases" element={<Purchases />} /><Route path="/import" element={<Import />} /><Route path="/users" element={<Users />} /><Route path="/settings" element={<Settings />} /><Route path="/book" element={<SalesHome />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} /></Route>}
    {user && user.role === 'SALES' && <Route element={<Shell user={user} logout={logout} authRequired={authRequired} />}>
      <Route path="/book" element={<SalesHome />} /><Route path="/entry" element={<Entry />} /><Route path="/reports" element={<Reports />} /><Route path="*" element={<Navigate to="/book" replace />} /></Route>}
    {!user && <Route path="*" element={<Navigate to="/login" replace />} />}
  </Routes></ToastProvider>;
}
