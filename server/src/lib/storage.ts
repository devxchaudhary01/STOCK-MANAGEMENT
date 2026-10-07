/** File storage abstraction. Local disk now; swap this module for S3/R2 later without touching routes. Only keys are stored in MongoDB. */
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { config } from '../config';

const root = path.resolve(config.storageDir);
export async function putFile(buf: Buffer, ext: string, folder = 'files'): Promise<string> {
  const d = new Date(); const key = `${folder}/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
  const full = path.join(root, key); await fs.promises.mkdir(path.dirname(full), { recursive: true }); await fs.promises.writeFile(full, buf); return key;
}
export async function getFile(key: string): Promise<Buffer> {
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');   // path traversal guard
  return fs.promises.readFile(full);
}

/** Sniff real file type from magic bytes (never trust the extension / client MIME type). */
export function sniff(buf: Buffer): 'pdf' | 'png' | 'jpg' | 'webp' | 'xlsx' | 'xls' | 'csv' | null {
  if (buf.length < 8) return null;
  if (buf.slice(0, 5).toString() === '%PDF-') return 'pdf';
  if (buf[0] === 0x89 && buf.slice(1, 4).toString() === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'xlsx';
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'xls';
  const head = buf.slice(0, 2048).toString('utf8'); if (!/[\x00-\x08]/.test(head) && head.includes(',')) return 'csv';
  return null;
}
export const MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
