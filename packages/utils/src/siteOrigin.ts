import { getPublicSuffix } from 'tldts';

export type SiteOriginError = 'insecure' | 'invalid' | 'path' | 'sharedHostWildcard';

export type SiteOriginResult =
  { ok: false; reason: SiteOriginError } | { ok: true; origin: string };

const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443' };
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ORIGIN_PATTERN = /^([a-z][\d+.a-z-]*):\/\/([^#/?]*)([#/?].*)?$/is;
const AUTHORITY_PATTERN = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/;
const MAX_PORT = 65_535;

const fail = (reason: SiteOriginError): SiteOriginResult => ({ ok: false, reason });

const canonicalHost = (scheme: string, host: string) => {
  try {
    return new URL(`${scheme}://${host}`).hostname;
  } catch {
    return undefined;
  }
};

export const normalizeSiteOrigin = (input: string): SiteOriginResult => {
  const match = ORIGIN_PATTERN.exec(input.trim());
  if (!match) return fail('invalid');

  const scheme = match[1].toLowerCase();
  const authority = match[2];
  const rest = match[3] ?? '';
  if (scheme !== 'http' && scheme !== 'https') return fail('invalid');
  if (!authority || authority.includes('@')) return fail('invalid');
  if (rest && rest !== '/') return fail('path');

  const parts = AUTHORITY_PATTERN.exec(authority);
  if (!parts) return fail('invalid');

  const rawHost = parts[1].toLowerCase();
  const wildcard = rawHost.startsWith('*.');
  const hostBody = wildcard ? rawHost.slice(2) : rawHost;
  if (!hostBody || hostBody.includes('*')) return fail('invalid');

  const hostname = canonicalHost(scheme, hostBody);
  if (!hostname) return fail('invalid');

  if (scheme === 'http' && (wildcard || !LOOPBACK_HOSTS.has(hostname))) return fail('insecure');

  if (wildcard) {
    const suffix = getPublicSuffix(hostname, { allowPrivateDomains: true });
    if (!hostname.includes('.') || !suffix || suffix === hostname) {
      return fail('sharedHostWildcard');
    }
  }

  // `new URL` rejects ports above 65535, so such an origin could never match a request.
  const portNumber = parts[2] === undefined ? undefined : Number(parts[2]);
  if (portNumber !== undefined && portNumber > MAX_PORT) return fail('invalid');
  const port =
    portNumber !== undefined && String(portNumber) !== DEFAULT_PORTS[scheme]
      ? `:${portNumber}`
      : '';
  return { ok: true, origin: `${scheme}://${wildcard ? '*.' : ''}${hostname}${port}` };
};

const parseRequestOrigin = (origin: string) => {
  try {
    const url = new URL(origin);
    if (url.origin === 'null') return undefined;
    return { host: url.hostname, port: url.port, scheme: url.protocol.slice(0, -1) };
  } catch {
    return undefined;
  }
};

export const siteOriginMatches = (pattern: string, requestOrigin: string): boolean => {
  const normalized = normalizeSiteOrigin(pattern);
  const request = parseRequestOrigin(requestOrigin);
  if (!normalized.ok || !request) return false;

  const allowed = parseRequestOrigin(normalized.origin.replace('://*.', '://wildcard.'));
  if (!allowed || allowed.scheme !== request.scheme || allowed.port !== request.port) return false;

  if (!normalized.origin.includes('://*.')) return allowed.host === request.host;

  const base = allowed.host.slice('wildcard.'.length);
  if (!request.host.endsWith(`.${base}`)) return false;
  const label = request.host.slice(0, -(base.length + 1));
  return label.length > 0 && !label.includes('.');
};
