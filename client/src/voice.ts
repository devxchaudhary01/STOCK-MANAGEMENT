/** Browser speech: listen (Chrome / Edge / Android) and speak back. No server, no API key. */
const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
export const voiceSupported = !!SR;
export type Lang = 'en-IN' | 'hi-IN';

export function listen(lang: Lang, onText: (t: string) => void, onEnd: () => void, onError: (m: string) => void): () => void {
  const r = new SR(); r.lang = lang; r.interimResults = false; r.maxAlternatives = 3; r.continuous = false;
  r.onresult = (e: any) => { const alts = Array.from(e.results[0] as ArrayLike<any>).map((a: any) => a.transcript as string); onText(alts[0]); };
  r.onerror = (e: any) => onError(e.error === 'not-allowed' ? 'Microphone permission is blocked. Allow it in the browser address bar.' : e.error === 'no-speech' ? 'Did not hear anything. Try again.' : `Voice error: ${e.error}`);
  r.onend = onEnd; r.start(); return () => { try { r.stop(); } catch { /* already stopped */ } };
}
export function speak(text: string, lang: Lang = 'en-IN') {
  if (!('speechSynthesis' in window)) return; window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = lang; u.rate = 0.95; window.speechSynthesis.speak(u);
}

// ---- understanding what was said ----
const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, bees: 20, tees: 30, chalis: 40, pachas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90 };
const HUNDRED = new Set(['hundred', 'sau']);
const UNIT_WORDS = '(?:pieces?|peace|pcs?|nos|numbers?|pis|units?|पीस|नग)';
const WORDS = [...Object.keys(UNITS), ...Object.keys(TENS), ...HUNDRED].join('|');
/** one digit group ("15") OR up to 3 number words ("twenty five"); digits and words are never glued together, so an item code like 160408 is not swallowed */
const NUM = `(?:\\d+|(?:${WORDS})(?:\\s+(?:${WORDS})){0,2})`;

/** "twenty five" -> 25, "ek sau pachas" -> 150, "15" -> 15 */
export function wordsToNumber(s: string): number | null {
  const t = s.toLowerCase().trim().split(/\s+/); if (t.length === 1 && /^\d+$/.test(t[0])) return Number(t[0]); let total = 0, cur = 0, seen = false;
  for (const w of t) { if (/^\d+$/.test(w)) { cur += Number(w); seen = true; } else if (w in UNITS) { cur += UNITS[w]; seen = true; } else if (w in TENS) { cur += TENS[w]; seen = true; } else if (HUNDRED.has(w)) { cur = (cur || 1) * 100; seen = true; } else if (w === 'and') continue; else return null; }
  total += cur; return seen ? total : null;
}
export interface Heard { raw: string; name: string; qty: number | null; book: boolean }
/**
 * Splits a sentence into item words + quantity + "book" intent.
 *  "btjnl 2525 m15"                    -> name only (search)
 *  "15 piece book" / "book 15"         -> qty 15, book (uses the item already on screen)
 *  "btjnl 2525 m15 15 piece book"      -> name + qty + book
 * A number is a quantity only when it is followed by a unit word (piece/pcs/nos), follows "book/qty", or stands alone, because item names contain numbers.
 */
export function parseVoice(raw: string): Heard {
  let t = ' ' + raw.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim() + ' '; let qty: number | null = null;
  const book = /\b(book|booking|karo|kar do|kardo|add|order)\b/.test(t);
  const grab = (re: RegExp, g = 1) => { const m = re.exec(t); if (!m) return false; const n = wordsToNumber(m[g]); if (n === null) return false; qty = n; t = t.replace(m[0], ' '); return true; };
  grab(new RegExp(`\\b(${NUM})\\s+${UNIT_WORDS}\\b`)) || grab(new RegExp(`\\b(?:book|booking|qty|quantity|add|order)\\s+(${NUM})\\b`)) || grab(new RegExp(`^\\s*(${NUM})\\s*(?:book|booking)?\\s*$`));
  const name = t.replace(/\b(book|booking|karo|kar do|kardo|please|qty|quantity|add|order|for|the|of|check|stock|show|search|find|ka|ki|ke)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return { raw, name, qty, book };
}
