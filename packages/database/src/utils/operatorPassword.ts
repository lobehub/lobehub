import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export const OPERATOR_PASSWORD_MIN_LENGTH = 8;
export const ADMIN_SESSION_COOKIE = 'aico_admin_session';

export const meetsOperatorPasswordComplexity = (password: string): boolean =>
  password.length >= OPERATOR_PASSWORD_MIN_LENGTH && /[A-Z]/i.test(password) && /\d/.test(password);

const UNUSABLE_PREFIX = 'unusable:';

export const hashOperatorPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
};

export const verifyOperatorPassword = async (password: string, hash: string): Promise<boolean> => {
  if (!hash || hash.startsWith(UNUSABLE_PREFIX)) return false;
  const [algo, salt, expectedHex] = hash.split(':');
  if (algo !== 'scrypt' || !salt || !expectedHex) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
};

export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const createSessionToken = (): string => randomBytes(32).toString('hex');

export const unusablePasswordHash = (seed: string): string => `${UNUSABLE_PREFIX}${seed}`;
