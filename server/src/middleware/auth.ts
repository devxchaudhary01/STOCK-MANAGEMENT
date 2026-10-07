import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { User } from '../models';
import { HttpError } from '../services/stock';

export type Role = 'ADMIN' | 'SALES';
export interface AuthUser { id: string; username: string; name: string; role: Role }
declare global { namespace Express { interface Request { user?: AuthUser } } }

export const signToken = (u: AuthUser) => jwt.sign({ sub: u.id, role: u.role }, config.jwtSecret, { expiresIn: config.jwtExpires as any, algorithm: 'HS256' });
/** Fixed id used for audit rows when login is disabled (AUTH_REQUIRED=false). */
export const OPEN_USER: AuthUser = { id: '000000000000000000000001', username: 'admin', name: 'Admin', role: 'ADMIN' };

// Tiny per-process cache so every request does not hit the users collection (stays fast with many users). Blocking a user takes effect within ~15s everywhere.
const cache = new Map<string, { u: AuthUser | null; t: number }>();
export const invalidateUser = (id?: string) => (id ? cache.delete(id) : cache.clear());
async function loadUser(id: string): Promise<AuthUser | null> {
  const hit = cache.get(id); if (hit && Date.now() - hit.t < 15_000) return hit.u;
  const d = await User.findById(id).lean(); const u = d && d.active ? { id: String(d._id), username: d.username, name: d.name, role: d.role as Role } : null;
  if (cache.size > 5000) cache.clear(); cache.set(id, { u, t: Date.now() }); return u;
}

export async function authRequired(req: Request, _res: Response, next: NextFunction) {
  if (!config.authRequired) { req.user = OPEN_USER; return next(); }
  try {
    const h = req.headers.authorization || ''; const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) throw new HttpError(401, 'Authentication required');
    let payload: any; try { payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }); } catch { throw new HttpError(401, 'Session expired, please log in again'); }
    const u = await loadUser(payload.sub); if (!u) throw new HttpError(401, 'Account blocked or removed');
    req.user = u; next();
  } catch (e) { next(e); }
}
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) =>
  req.user && roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Admin access required'));
export const actor = (req: Request) => ({ userId: req.user!.id, userName: req.user!.name });
