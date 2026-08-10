import { createHash, timingSafeEqual } from 'node:crypto';

/** Tokens that must never gate `/internal/*` (public examples / placeholders). */
const FORBIDDEN_SERVICE_TOKENS = new Set(['', 'devtok', 'changeme', 'secret', 'password', 'token']);

const MIN_TOKEN_LENGTH = 24;

export const isWeakControlPlaneServiceToken = (token: string | undefined | null): boolean => {
  if (token == null) return true;
  const trimmed = token.trim();
  if (trimmed.length < MIN_TOKEN_LENGTH) return true;
  if (FORBIDDEN_SERVICE_TOKENS.has(trimmed.toLowerCase())) return true;
  return false;
};

/** Constant-time string compare via SHA-256 digests (length-independent). */
export const timingSafeStringEqual = (a: string, b: string): boolean => {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
};

/**
 * Validate the shared product ↔ control-plane bearer token before serving
 * `/internal/*`. Weak tokens (including the old `devtok` default) are rejected.
 */
export const assertServiceTokenConfigured = (
  token: string | undefined = process.env.AICO_CONTROL_PLANE_SERVICE_TOKEN,
): string => {
  if (isWeakControlPlaneServiceToken(token)) {
    throw new Error(
      'AICO_CONTROL_PLANE_SERVICE_TOKEN is missing or too weak. Set a random token ' +
        `(≥${MIN_TOKEN_LENGTH} chars), e.g. \`openssl rand -hex 32\`. ` +
        'The placeholder `devtok` is not allowed.',
    );
  }
  return token!.trim();
};

export const assertBearerServiceToken = (req: Request): boolean => {
  let expected: string;
  try {
    expected = assertServiceTokenConfigured();
  } catch {
    return false;
  }

  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) return false;
  return timingSafeStringEqual(token, expected);
};
