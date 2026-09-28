/**
 * Report-boundary redaction.
 *
 * The whole report — `--json` and `-v` evidence included — exists to be pasted
 * into an issue, so anything that reaches it has to be safe to share. These
 * helpers are applied where a value enters a detail, a fix, or evidence; the
 * raw values keep flowing to the code that actually connects.
 */

/**
 * `https://user:password@host` is a normal way to point at a
 * basic-auth-protected deployment or a corporate proxy. Keep the host, drop
 * the credential.
 */
export function redactUrlCredentials(value: string): string;
export function redactUrlCredentials(value: string | undefined): string | undefined;
export function redactUrlCredentials(value: string | undefined): string | undefined {
  if (!value) return value;

  try {
    const url = new URL(value);
    if (!url.username && !url.password) return value;
    if (url.username) url.username = '***';
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    // Not a URL (NO_PROXY is a host list) — nothing to redact.
    return value;
  }
}

/**
 * Enough of an address to recognise which account answered, not enough to
 * hand someone else the address itself.
 */
export function maskEmail(value: string | undefined): string | undefined {
  if (!value) return value;

  const at = value.lastIndexOf('@');
  if (at <= 0) return '***';

  const [local, domain] = [value.slice(0, at), value.slice(at + 1)];
  const head = local.slice(0, 1);
  const dot = domain.lastIndexOf('.');
  const maskedDomain = dot > 0 ? `${domain.slice(0, 1)}***${domain.slice(dot)}` : '***';

  return `${head}***@${maskedDomain}`;
}

/**
 * Gateway client errors quote the full WebSocket URL, whose query string
 * carries this machine's hostname, its device id and the user id. The failure
 * is worth reporting; that query string is not.
 */
export function redactUrlsInMessage(message: string): string {
  // Tokenise first, then decide per token. A single pattern that matches the
  // URL and then *requires* a `?` backtracks across the rest of the string at
  // every starting position — quadratic, and what CodeQL flags as a ReDoS.
  // `[^\s'"]+` has nothing following it to backtrack for.
  return message.replaceAll(/[^\s'"]+/g, (token) =>
    /^wss?:\/\//i.test(token) ? token.split('?')[0]! : token,
  );
}

const EMAIL_TOKEN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * Scrub one whitespace/quote-delimited token. Index arithmetic rather than a
 * regex so the cost stays linear in the token length whatever it contains.
 */
function scrubToken(token: string): string {
  const schemeEnd = token.indexOf('://');

  if (schemeEnd === -1) return EMAIL_TOKEN.test(token) ? maskEmail(token)! : token;

  const authorityStart = schemeEnd + 3;
  let authorityEnd = token.length;
  for (const delimiter of ['/', '?', '#']) {
    const index = token.indexOf(delimiter, authorityStart);
    if (index !== -1 && index < authorityEnd) authorityEnd = index;
  }

  let scrubbed = token;
  const at = token.lastIndexOf('@', authorityEnd - 1);
  if (at >= authorityStart)
    scrubbed = `${token.slice(0, authorityStart)}***@${token.slice(at + 1)}`;

  // WebSocket URLs from the gateway client carry device id, hostname and user
  // id in their query string.
  if (/^wss?:\/\//i.test(scrubbed)) scrubbed = scrubbed.split('?')[0]!;

  return scrubbed;
}

/** Credentials in URLs, WebSocket query strings and email addresses, anywhere in a string. */
export function scrubText(text: string): string {
  return text.replaceAll(/[^\s'"`()<>]+/g, scrubToken);
}

/**
 * Scrub every string reachable from a value. The runner applies this to each
 * result before it enters the report, so a check that forgets to redact
 * something — the failure mode three review rounds kept finding one instance of
 * at a time — cannot leak it.
 */
export function scrubDeep<T>(value: T): T {
  if (typeof value === 'string') return scrubText(value) as T;
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, scrubDeep(item)]),
    ) as T;
  return value;
}
