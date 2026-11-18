/**
 * Embed-origin allowlist rules, shared by the share settings (validation), the
 * server (the `frame-ancestors` header) and the docs. One implementation, so a
 * value the settings accept is exactly a value the header can carry.
 *
 * An entry is a bare origin — scheme, host, optional port — never a path:
 * `frame-ancestors` matches origins, and anything else in the header value
 * (spaces, quotes, `;`) would let a creator inject other CSP directives.
 */

/** Upper bound on allowlist entries per share; keeps the response header small. */
export const EMBED_ALLOWED_ORIGINS_LIMIT = 20;

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';

/**
 * `http(s)://host[:port]`, where host may start with one `*.` wildcard label.
 * A wildcard needs at least two labels after it (`*.example.com`), so `*.com`
 * cannot open framing to a whole top-level domain.
 */
const ORIGIN_PATTERN = new RegExp(
  `^(https?)://((?:\\*\\.)?)(${LABEL}(?:\\.${LABEL})*)(?::(\\d{1,5}))?$`,
);

/**
 * Normalize one allowlist entry, or `null` when it is not a valid embed origin.
 * Lowercases, trims and drops one trailing `/`, so `https://Example.com/` and
 * `https://example.com` are the same entry.
 */
export const normalizeEmbedOrigin = (input: string): string | null => {
  const value = input.trim().toLowerCase().replace(/\/$/, '');
  const match = ORIGIN_PATTERN.exec(value);
  if (!match) return null;

  const [, scheme, wildcard, host, port] = match;

  if (wildcard && host!.split('.').length < 2) return null;

  if (port !== undefined) {
    const portNumber = Number(port);
    if (portNumber < 1 || portNumber > 65_535) return null;
    // The scheme's default port is the same origin without one.
    if ((scheme === 'https' && portNumber === 443) || (scheme === 'http' && portNumber === 80)) {
      return `${scheme}://${wildcard}${host}`;
    }
  }

  return value;
};

export interface EmbedOriginsParseResult {
  /** Entries that are not valid origins, as typed. */
  invalid: string[];
  /** Normalized, de-duplicated, in input order. */
  origins: string[];
}

/** Normalize a whole allowlist, keeping the first spelling of each origin. */
export const parseEmbedOrigins = (inputs: readonly string[]): EmbedOriginsParseResult => {
  const origins: string[] = [];
  const invalid: string[] = [];

  for (const input of inputs) {
    if (!input.trim()) continue;
    const origin = normalizeEmbedOrigin(input);
    if (!origin) invalid.push(input);
    else if (!origins.includes(origin)) origins.push(origin);
  }

  return { invalid, origins };
};

/** `frame-ancestors` source list for an allowlist; an empty list forbids framing. */
export const buildFrameAncestorsDirective = (origins: readonly string[] | null | undefined) => {
  const valid = (origins ?? []).map(normalizeEmbedOrigin).filter((o): o is string => !!o);

  return valid.length > 0 ? `frame-ancestors ${valid.join(' ')}` : "frame-ancestors 'none'";
};
