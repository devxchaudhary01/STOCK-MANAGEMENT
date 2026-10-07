import { describe, it, expect, beforeAll } from 'vitest';
let parseVoice: (s: string) => any; let wordsToNumber: (s: string) => number | null;
beforeAll(async () => { (globalThis as any).window = {}; const m = await import('../../client/src/voice'); parseVoice = m.parseVoice; wordsToNumber = m.wordsToNumber; });

describe('voice understanding (English + Hindi words)', () => {
  it('item name only -> search, numbers in the code stay in the name', () => {
    expect(parseVoice('btjnl 2525 m15')).toMatchObject({ name: 'btjnl 2525 m15', qty: null, book: false });
  });
  it('"15 piece book" and "book 15" -> quantity for the item already on screen', () => {
    expect(parseVoice('15 piece book')).toMatchObject({ name: '', qty: 15, book: true });
    expect(parseVoice('book 15')).toMatchObject({ name: '', qty: 15, book: true });
    expect(parseVoice('15 book')).toMatchObject({ name: '', qty: 15, book: true });
  });
  it('item + quantity + book in one sentence', () => {
    expect(parseVoice('btjnl 2525 m15 15 piece book')).toMatchObject({ name: 'btjnl 2525 m15', qty: 15, book: true });
    expect(parseVoice('tnmg 160408 fifty pieces')).toMatchObject({ name: 'tnmg 160408', qty: 50 });
  });
  it('number words: English and Hindi', () => {
    expect(wordsToNumber('twenty five')).toBe(25); expect(wordsToNumber('one hundred fifty')).toBe(150); expect(wordsToNumber('pandrah')).toBe(15); expect(wordsToNumber('ek sau pachas')).toBe(150); expect(wordsToNumber('42')).toBe(42); expect(wordsToNumber('hello')).toBeNull();
    expect(parseVoice('pandrah piece book karo')).toMatchObject({ qty: 15, book: true });
  });
  it('filler words are dropped from the item name', () => {
    expect(parseVoice('check stock of btjnl 2525 m15 please').name).toBe('btjnl 2525 m15');
  });
});
