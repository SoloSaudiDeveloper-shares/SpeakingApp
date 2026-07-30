import crypto from 'crypto';

const LEGACY_PBKDF2_ITERATIONS = 100_000;
const PBKDF2_ITERATIONS = 220_000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';
const HASH_SCHEME = 'pbkdf2-sha512';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

// Small offline blocklist of repeatedly breached/common choices. This is kept
// local so password material is never sent to a third party during signup or
// reset. Administrators should still use generated temporary credentials.
const COMMON_COMPROMISED_PASSWORDS = new Set([
  '123456789012',
  '1234567890ab',
  'adminadmin',
  'changeme123!',
  'iloveyou123!',
  'letmein12345',
  'password123',
  'password123!',
  'passwordpassword',
  'qwerty123456', // gitleaks:allow -- intentional compromised-password blocklist entry
  'welcome12345',
]);

export function passwordPolicyViolation(
  password: string,
  context: { username?: string; displayName?: string } = {},
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must contain at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  const normalized = password.normalize('NFKC').toLowerCase();
  const compact = normalized.replace(/\s+/g, '');
  if (
    COMMON_COMPROMISED_PASSWORDS.has(compact) ||
    /^(.)\1{11,}$/.test(compact) ||
    /^(?:0123456789|1234567890|qwertyuiop|abcdefghijklmnopqrstuvwxyz)+$/.test(compact)
  ) {
    return 'Choose a password that is not commonly used or known to be compromised.';
  }
  const identityParts = [context.username, context.displayName]
    .flatMap((value) => value?.normalize('NFKC').toLowerCase().split(/[^a-z0-9]+/) ?? [])
    .filter((part) => part.length >= 4);
  if (identityParts.some((part) => compact.includes(part))) {
    return 'Password must not contain your username or name.';
  }
  return null;
}

export function assertPasswordPolicy(
  password: string,
  context: { username?: string; displayName?: string } = {},
): void {
  const violation = passwordPolicyViolation(password, context);
  if (violation) throw new Error(violation);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST);
  return [
    HASH_SCHEME,
    String(PBKDF2_ITERATIONS),
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    let iterations: number;
    let saltB64: string;
    let hashB64: string;
    if (storedHash.startsWith(`${HASH_SCHEME}$`)) {
      const [scheme, iterationsText, versionedSalt, versionedHash, extra] = storedHash.split('$');
      if (
        scheme !== HASH_SCHEME ||
        !versionedSalt ||
        !versionedHash ||
        extra !== undefined
      ) return false;
      iterations = Number(iterationsText);
      saltB64 = versionedSalt;
      hashB64 = versionedHash;
      if (
        !Number.isSafeInteger(iterations) ||
        iterations < LEGACY_PBKDF2_ITERATIONS ||
        iterations > 1_000_000
      ) {
        return false;
      }
    } else {
      const [legacySalt, legacyHash, extra] = storedHash.split('.');
      if (!legacySalt || !legacyHash || extra !== undefined) return false;
      iterations = LEGACY_PBKDF2_ITERATIONS;
      saltB64 = legacySalt;
      hashB64 = legacyHash;
    }
    const salt = Buffer.from(saltB64, 'base64');
    const expectedHash = Buffer.from(hashB64, 'base64');
    if (salt.length !== 16 || expectedHash.length !== KEY_LENGTH) return false;
    const actualHash = crypto.pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST);
    return crypto.timingSafeEqual(expectedHash, actualHash);
  } catch {
    return false;
  }
}

export function passwordHashNeedsUpgrade(storedHash: string): boolean {
  const [scheme, iterationsText] = storedHash.split('$');
  if (scheme !== HASH_SCHEME) return true;
  const iterations = Number(iterationsText);
  return !Number.isSafeInteger(iterations) || iterations < PBKDF2_ITERATIONS;
}
