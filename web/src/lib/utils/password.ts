import crypto from 'crypto';

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST);
  return `${salt.toString('base64')}.${hash.toString('base64')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [saltB64, hashB64] = storedHash.split('.');
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expectedHash = Buffer.from(hashB64, 'base64');
  const actualHash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST);
  return crypto.timingSafeEqual(expectedHash, actualHash);
}
