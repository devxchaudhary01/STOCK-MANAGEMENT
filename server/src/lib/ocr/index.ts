/**
 * OCR abstraction. Routes only talk to OcrProvider; swap the provider with OCR_PROVIDER env var.
 *  - anthropic : Claude vision/PDF reading (needs ANTHROPIC_API_KEY)
 *  - mock      : returns OCR_MOCK_LINES (JSON) – for tests / demos
 *  - none      : OCR disabled (upload still stores the invoice; user can enter lines manually)
 * We extract ONLY item name + quantity. No prices, tax, addresses.
 */
import { config } from '../../config';
export interface OcrLine { rawName: string; quantity: number | null }
export interface OcrFile { buffer: Buffer; mime: string; filename: string }
export interface OcrProvider { name: string; extract(file: OcrFile): Promise<OcrLine[]> }

const PROMPT = `You read supplier invoices for a cutting-tools company. Extract ONLY the line items: the item name/description exactly as printed (keep model codes like "BTJNL 2525 M16" intact) and the quantity. Ignore prices, GST/tax, totals, addresses, bank and payment details. Respond with ONLY a JSON array, no markdown: [{"name":"...","quantity":number}]. If a quantity is unreadable use null.`;

export function parseModelJson(text: string): OcrLine[] {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('['), end = cleaned.lastIndexOf(']');
  if (start < 0 || end < 0) throw new Error('OCR provider did not return a JSON array');
  const arr = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error('OCR output is not an array');
  return arr.map((x: any) => ({ rawName: String(x?.name ?? x?.item ?? '').replace(/\s+/g, ' ').trim(), quantity: x?.quantity === null || x?.quantity === undefined || x?.quantity === '' ? null : Number(x.quantity) }))
    .filter(l => l.rawName).map(l => ({ ...l, quantity: l.quantity !== null && Number.isFinite(l.quantity) ? l.quantity : null }));
}

class AnthropicProvider implements OcrProvider {
  name = 'anthropic';
  async extract(f: OcrFile) {
    if (!config.ocr.apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
    const data = f.buffer.toString('base64');
    const block = f.mime === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: f.mime, data } } : { type: 'image', source: { type: 'base64', media_type: f.mime, data } };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': config.ocr.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.ocr.model, max_tokens: 4096, messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }] }),
    });
    if (!res.ok) throw new Error(`OCR provider error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j: any = await res.json();
    return parseModelJson((j.content || []).map((c: any) => c.text || '').join('\n'));
  }
}
class MockProvider implements OcrProvider { name = 'mock'; async extract() { return process.env.OCR_MOCK_LINES ? parseModelJson(process.env.OCR_MOCK_LINES) : []; } }
class NoneProvider implements OcrProvider { name = 'none'; async extract(): Promise<OcrLine[]> { throw new Error('OCR is not configured (set OCR_PROVIDER and API key). You can still add lines manually.'); } }

let override: OcrProvider | null = null;
export const setOcrProvider = (p: OcrProvider | null) => { override = p; };
export function getOcrProvider(): OcrProvider {
  if (override) return override;
  return config.ocr.provider === 'anthropic' ? new AnthropicProvider() : config.ocr.provider === 'mock' ? new MockProvider() : new NoneProvider();
}
