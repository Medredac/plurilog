import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
export function hashSecret(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function key(): Buffer {
  const value = process.env.GOOGLE_APPS_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Google encryption is not configured');
  return Buffer.from(value, 'hex');
}
export function encryptGoogle(value: unknown, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`plurilog-google-preview-v1:${context}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(buffer => buffer.toString('base64url')).join('.');
}
export function decryptGoogle<T>(value: string, context: string): T {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted record');
  const [iv, tag, ciphertext] = parts.map(part => Buffer.from(part, 'base64url'));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted record');
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`plurilog-google-preview-v1:${context}`)); cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8')) as T;
}
