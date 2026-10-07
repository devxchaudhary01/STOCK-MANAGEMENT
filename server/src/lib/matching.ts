/** Item-name normalisation + matching, shared by Excel import, bulk-qty update and OCR. */
export const normKey = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
/** Strips everything except A-Z0-9 so 'BAP300R-12-C12' == 'BAP300R-Ø12-C12' == 'bap300r 12 c12'. */
export const looseKey = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const bigrams = (s: string) => { const out = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; };
function dice(a: Map<string, number>, b: Map<string, number>, na: number, nb: number) {
  if (!na || !nb) return 0; let inter = 0;
  for (const [g, c] of a) { const d = b.get(g); if (d) inter += Math.min(c, d); }
  return (2 * inter) / (na + nb);
}
export interface MatchableItem { id: string; name: string; code?: string | null }
export type MatchType = 'EXACT' | 'CODE' | 'LOOSE' | 'AMBIGUOUS' | 'FUZZY' | 'NONE';
export interface Candidate { id: string; name: string; score: number }
export interface MatchResult<T = MatchableItem> { type: MatchType; item?: T; score?: number; candidates: Candidate[] }

export function buildMatcher<T extends MatchableItem>(items: T[], opts: { fuzzyThreshold?: number } = {}) {
  const thr = opts.fuzzyThreshold ?? 0.88;
  const byName = new Map<string, T>(), byCode = new Map<string, T>(), byLoose = new Map<string, T[]>();
  const grams: { it: T; g: Map<string, number>; n: number }[] = [];
  for (const it of items) {
    const k = normKey(it.name);
    byName.set(k, it);
    if (it.code) byCode.set(normKey(it.code), it);
    const lk = looseKey(it.name);
    if (lk) { const a = byLoose.get(lk) || []; a.push(it); byLoose.set(lk, a); }
    grams.push({ it, g: bigrams(k), n: Math.max(k.length - 1, 0) });
  }
  function fuzzy(name: string, limit = 3): Candidate[] {
    const k = normKey(name); const g = bigrams(k); const n = Math.max(k.length - 1, 0);
    const scored: Candidate[] = [];
    for (const x of grams) { const sc = dice(g, x.g, n, x.n); if (sc >= thr) scored.push({ id: x.it.id, name: x.it.name, score: Math.round(sc * 100) / 100 }); }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  function match(name: string, code?: string | null): MatchResult<T> {
    if (code) { const c = byCode.get(normKey(code)); if (c) return { type: 'CODE', item: c, score: 1, candidates: [] }; }
    const e = byName.get(normKey(name)); if (e) return { type: 'EXACT', item: e, score: 1, candidates: [] };
    const l = byLoose.get(looseKey(name));
    if (l && l.length === 1) return { type: 'LOOSE', item: l[0], score: 0.99, candidates: [] };
    if (l && l.length > 1) return { type: 'AMBIGUOUS', candidates: l.map(x => ({ id: x.id, name: x.name, score: 0.99 })) };
    const f = fuzzy(name);
    return f.length ? { type: 'FUZZY', candidates: f, score: f[0].score } : { type: 'NONE', candidates: [] };
  }
  return { match, fuzzy };
}
