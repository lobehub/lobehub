const EXPIRED_COOKIE_DATE = 'Thu, 01 Jan 1970 00:00:00 GMT';
const EXPO_ORIGIN_HEADER = 'expo-origin';

interface ParsedSetCookie {
  attributes: Map<string, string>;
  name: string;
}

const parseSetCookie = (header: string): ParsedSetCookie | undefined => {
  const [pair, ...rest] = header.split(';');
  const separator = pair.indexOf('=');
  if (separator < 1) return undefined;

  const attributes = new Map<string, string>();
  for (const attribute of rest) {
    const index = attribute.indexOf('=');
    const key = (index === -1 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
    if (key) attributes.set(key, index === -1 ? '' : attribute.slice(index + 1).trim());
  }

  return { attributes, name: pair.slice(0, separator).trim() };
};

const toHostOnlyExpiry = ({ attributes, name }: ParsedSetCookie): string => {
  const parts = [
    `${name}=`,
    `Path=${attributes.get('path') || '/'}`,
    'Max-Age=0',
    `Expires=${EXPIRED_COOKIE_DATE}`,
  ];

  const sameSite = attributes.get('samesite');
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (attributes.has('httponly')) parts.push('HttpOnly');
  if (attributes.has('secure')) parts.push('Secure');

  return parts.join('; ');
};

// Switching to `crossSubDomainCookies` only adds a `Domain` attribute, the cookie name stays the
// same. Browsers key cookies by (name, domain, path), so a cookie written before the switch lives
// on as a separate host-only twin that sorts first in the `Cookie` header and shadows the new
// domain-wide one — sign-out cannot reach it either, since it expires the domain-scoped copy only.
// Expiring the twin next to every domain-scoped write keeps the two from ever coexisting.
export const expireLegacyHostOnlyCookies = (
  request: Request,
  response: Response,
  cookieDomain: string,
): Response => {
  // `@better-auth/expo` keeps cookies in a name-keyed store with no domain, where this expiry would
  // instead delete the token the same response just issued.
  if (request.headers.has(EXPO_ORIGIN_HEADER)) return response;

  const base = cookieDomain.replace(/^\./, '').toLowerCase();
  const expiries = new Map<string, string>();

  for (const header of response.headers.getSetCookie()) {
    const parsed = parseSetCookie(header);
    if (!parsed || expiries.has(parsed.name)) continue;

    const domain = parsed.attributes.get('domain')?.replace(/^\./, '').toLowerCase();
    if (domain !== base) continue;

    expiries.set(parsed.name, toHostOnlyExpiry(parsed));
  }

  for (const header of expiries.values()) response.headers.append('set-cookie', header);

  return response;
};
