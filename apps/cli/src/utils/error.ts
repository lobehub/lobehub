import { errorCauseFrom, errorMessageFrom } from '@lobechat/utils/error';
import { toRecord } from '@lobechat/utils/object';

const TRANSIENT_NETWORK_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ConnectionRefused',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function getErrorCause(error: unknown): unknown {
  return errorCauseFrom(error) ?? toRecord(error)?.cause;
}

function getErrorCode(error: unknown): string | undefined {
  const code = toRecord(error)?.code;
  return typeof code === 'string' ? code : undefined;
}

function getErrorMessage(error: unknown): string | undefined {
  const message = errorMessageFrom(error) ?? toRecord(error)?.message;
  return typeof message === 'string' ? message : undefined;
}

function getErrorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;

  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    chain.push(current);

    const cause = getErrorCause(current);
    if (cause === undefined) break;
    current = cause;
  }

  return chain;
}

export function formatError(error: unknown): string {
  const details: string[] = [];

  for (const current of getErrorChain(error)) {
    const message = getErrorMessage(current);
    if (message && !details.includes(message)) details.push(message);

    const code = getErrorCode(current);
    if (code && !details.includes(code)) details.push(code);
  }

  return details.join(': ') || String(error);
}

export function isTransientNetworkError(error: unknown): boolean {
  return getErrorChain(error).some((current) => {
    const message = getErrorMessage(current);
    if (message && /^(?:fetch failed|failed to fetch)$/i.test(message)) return true;

    const code = getErrorCode(current);
    return code !== undefined && TRANSIENT_NETWORK_ERROR_CODES.has(code);
  });
}
