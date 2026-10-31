/**
 * The mock tool service eval attempts forward their connector calls to.
 *
 * Its address is deployment configuration (`EVAL_TOOL_MOCK_BASE_URL`), never
 * something a benchmark, a case or a user supplies: the forwarding hook sends
 * the server's shared secret (`EVAL_TOOL_FORWARDING_TOKEN`) with every call,
 * so the only destination that may ever receive it is this one. Benchmarks and
 * cases still choose *what* runs on the mock (dataset segment, connectors);
 * stored `baseUrl` / `endpoint` values are ignored.
 */

export const EVAL_TOOL_MOCK_BASE_URL_ENV = 'EVAL_TOOL_MOCK_BASE_URL';

export const MOCK_SERVICE_NOT_CONFIGURED = `The mock tool service is not configured on this server (${EVAL_TOOL_MOCK_BASE_URL_ENV})`;

const parseBase = (raw: string): URL => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${EVAL_TOOL_MOCK_BASE_URL_ENV} is not a valid URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${EVAL_TOOL_MOCK_BASE_URL_ENV} must be an http(s) URL`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      `${EVAL_TOOL_MOCK_BASE_URL_ENV} must be a plain origin with an optional path (no credentials, query or fragment)`,
    );
  }
  return url;
};

/**
 * The trusted mock origin (plus optional path prefix) without a trailing slash,
 * or `undefined` when the deployment has not configured one. Throws on a value
 * that is set but malformed, so a typo fails loudly instead of silently
 * disabling forwarding.
 */
export const getTrustedMockBaseUrl = (): string | undefined => {
  const raw = process.env[EVAL_TOOL_MOCK_BASE_URL_ENV]?.trim();
  if (!raw) return undefined;
  const url = parseBase(raw);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
};

/**
 * Whether a forwarding endpoint belongs to the trusted mock: same origin
 * (scheme, host and port) and under its path prefix. Anything else, including
 * a stored endpoint from before the mock moved, must never receive the token.
 */
export const isTrustedMockEndpoint = (endpoint: string | undefined): boolean => {
  if (!endpoint) return false;
  let base: string | undefined;
  try {
    base = getTrustedMockBaseUrl();
  } catch {
    return false;
  }
  if (!base) return false;
  let target: URL;
  try {
    target = new URL(endpoint);
  } catch {
    return false;
  }
  const trusted = new URL(base);
  if (target.origin !== trusted.origin || target.username || target.password) return false;
  const prefix = trusted.pathname.replace(/\/+$/, '');
  return target.pathname === prefix || target.pathname.startsWith(`${prefix}/`);
};
