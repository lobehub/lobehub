import { getServerDB } from '@/database/core/db-adaptor';
import { PlatformAdminUserModel } from '@/database/models/platformAdminUser';
import { ADMIN_SESSION_COOKIE, hashSessionToken } from '@/database/utils/operatorPassword';

export { ADMIN_SESSION_COOKIE };

export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export const parseCookieValue = (cookieHeader: string | null, name: string): string | undefined => {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || undefined;
  }
  return undefined;
};

export const isInsecureAdminCookie = () =>
  process.env.AICO_INSECURE_AUTH_COOKIES === '1' ||
  (process.env.AICO_CONTROL_PLANE_PUBLIC_URL || '').startsWith('http://');

export const serializeAdminSessionCookie = (token: string, maxAge = ADMIN_SESSION_TTL_SECONDS) => {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (!isInsecureAdminCookie()) parts.push('Secure');
  return parts.join('; ');
};

export const serializeClearedAdminSessionCookie = () => serializeAdminSessionCookie('', 0);

export const resolveAdminIdFromRequest = async (request: {
  headers: Headers;
}): Promise<string | undefined> => {
  const token = parseCookieValue(request.headers.get('cookie'), ADMIN_SESSION_COOKIE);
  if (!token) return undefined;
  const db = await getServerDB();
  const found = await new PlatformAdminUserModel(db).findValidSessionByTokenHash(
    hashSessionToken(token),
  );
  return found?.admin.id;
};
