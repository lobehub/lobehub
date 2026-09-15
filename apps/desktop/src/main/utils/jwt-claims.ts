import { Buffer } from 'node:buffer';

interface JwtClaimSummary {
  clientId?: string;
  exp?: number;
  iat?: number;
  sub?: string;
}

const decodeSegment = (segment: string): Record<string, unknown> | null => {
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const readJwtClaims = (token: string): JwtClaimSummary | null => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = decodeSegment(parts[1]);
  if (!payload) return null;
  return {
    clientId: typeof payload.client_id === 'string' ? payload.client_id : undefined,
    exp: typeof payload.exp === 'number' ? payload.exp : undefined,
    iat: typeof payload.iat === 'number' ? payload.iat : undefined,
    sub: typeof payload.sub === 'string' ? payload.sub : undefined,
  };
};

export const describeJwtClaims = (token: string | null | undefined, now = Date.now()) => {
  if (!token) return 'token=none';
  const claims = readJwtClaims(token);
  if (!claims) return 'token=opaque';

  const parts: string[] = [];
  if (claims.sub) parts.push(`sub=${claims.sub.slice(0, 8)}`);
  if (claims.clientId) parts.push(`client=${claims.clientId}`);
  if (claims.iat) parts.push(`iat=${new Date(claims.iat * 1000).toISOString()}`);
  if (claims.exp) {
    const remaining = Math.round(claims.exp - now / 1000);
    parts.push(`exp=${new Date(claims.exp * 1000).toISOString()}`);
    parts.push(remaining < 0 ? `expiredBy=${-remaining}s` : `expiresIn=${remaining}s`);
  }
  return parts.length ? `token{${parts.join(' ')}}` : 'token=no-claims';
};
