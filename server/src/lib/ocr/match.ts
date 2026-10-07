import { buildMatcher, MatchableItem, Candidate } from '../matching';
import { OcrLine } from './index';

export type OcrMatchStatus = 'MATCHED' | 'SUGGESTED' | 'UNMATCHED';
export interface OcrRow { rawName: string; quantity: number | null; status: OcrMatchStatus; itemId?: string; itemName?: string; candidates: Candidate[]; qtyValid: boolean }

/** MATCHED = exact/code/punctuation-insensitive hit (green). SUGGESTED = only a fuzzy guess (needs user confirmation). UNMATCHED = red. */
export function matchOcrLines(lines: OcrLine[], items: MatchableItem[]): OcrRow[] {
  const m = buildMatcher(items, { fuzzyThreshold: 0.8 });
  return lines.map((l) => {
    const r = m.match(l.rawName); const qtyValid = l.quantity !== null && l.quantity > 0;
    if (r.item && r.type !== 'FUZZY') return { rawName: l.rawName, quantity: l.quantity, status: 'MATCHED' as const, itemId: r.item.id, itemName: r.item.name, candidates: [], qtyValid };
    if (r.candidates.length) return { rawName: l.rawName, quantity: l.quantity, status: 'SUGGESTED' as const, candidates: r.candidates, qtyValid };
    return { rawName: l.rawName, quantity: l.quantity, status: 'UNMATCHED' as const, candidates: [], qtyValid };
  });
}
