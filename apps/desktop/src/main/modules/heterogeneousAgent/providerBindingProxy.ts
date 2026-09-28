import { randomBytes } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pipeline } from 'node:stream/promises';

import {
  type HeterogeneousProviderBindingProtocol,
  normalizeAnthropicSdkBaseURL,
} from '@lobechat/heterogeneous-agents';
import { isRecord, pickString } from '@lobechat/utils/object';
import { request } from 'undici';

import { createLogger } from '@/utils/logger';
import { classifyProxyNetworkError } from '@/utils/proxy-network-error';

type ProxyProtocol = Extract<
  HeterogeneousProviderBindingProtocol,
  'anthropic-messages' | 'openai-chat-completions'
>;

interface StartProviderBindingProxyParams {
  apiKey: string;
  endpoint?: string;
  protocol: ProxyProtocol;
}

export interface ProviderBindingProxy {
  clientApiKey: string;
  close: () => Promise<void>;
  closeSync: () => void;
  endpoint: string;
}

const logger = createLogger('modules:heterogeneousAgent:providerBindingProxy');
const MAX_ERROR_CAUSE_DEPTH = 5;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const appendPath = (baseURL: string, suffix: string): URL => {
  const url = new URL(baseURL);
  const basePath = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/${suffix}`;
  return url;
};

const resolveProxyRoute = (protocol: ProxyProtocol, endpoint?: string) => {
  if (protocol === 'openai-chat-completions') {
    return {
      clientBasePath: '/v1',
      requestPath: '/v1/chat/completions',
      upstreamURL: appendPath(endpoint ?? 'https://api.openai.com/v1', 'chat/completions'),
    };
  }

  const upstreamBaseURL = normalizeAnthropicSdkBaseURL(endpoint ?? 'https://api.anthropic.com');
  if (!upstreamBaseURL) throw new Error('Anthropic provider endpoint is invalid.');
  return {
    clientBasePath: '',
    requestPath: '/v1/messages',
    upstreamURL: appendPath(upstreamBaseURL, 'v1/messages'),
  };
};

const copyHeaders = (
  source: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> => {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  return headers;
};

const buildUpstreamHeaders = (
  source: IncomingHttpHeaders,
  clientApiKey: string,
  upstreamApiKey: string,
): Record<string, string | string[]> | undefined => {
  const headers = copyHeaders(source);
  delete headers.authorization;
  delete headers['x-api-key'];

  let authorized = false;
  const authorization = source.authorization;
  if (
    typeof authorization === 'string' &&
    authorization.slice(0, 7).toLowerCase() === 'bearer ' &&
    authorization.slice(7) === clientApiKey
  ) {
    headers.authorization = `Bearer ${upstreamApiKey}`;
    authorized = true;
  }

  const xApiKey = source['x-api-key'];
  if (xApiKey === clientApiKey) {
    headers['x-api-key'] = upstreamApiKey;
    authorized = true;
  }

  return authorized ? headers : undefined;
};

const writeError = (response: ServerResponse, statusCode: number, message: string): void => {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(message);
};

const getTransportFailureDiagnostic = (error: unknown) => {
  const reasons: string[] = [];
  let code: string | undefined;
  let current = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH && current; depth += 1) {
    if (current instanceof Error) reasons.push(current.message);
    if (!isRecord(current)) break;

    const currentCode = pickString(current.code);
    if (!code && currentCode && SAFE_ERROR_CODE.test(currentCode)) code = currentCode;

    const currentMessage = pickString(current.message);
    if (!(current instanceof Error) && currentMessage) reasons.push(currentMessage);
    current = current.cause;
  }

  return {
    code,
    errorType: classifyProxyNetworkError(reasons.join(' ')),
  };
};

const writeProviderRequestFailure = (
  response: ServerResponse,
  error: unknown,
  protocol: ProxyProtocol,
  upstreamOrigin: string,
): void => {
  const diagnostic = getTransportFailureDiagnostic(error);
  logger.error('Provider binding relay request failed', {
    code: diagnostic.code ?? 'UNKNOWN',
    errorType: diagnostic.errorType,
    protocol,
    upstreamOrigin,
  });
  writeError(response, 502, `Provider request failed: ${diagnostic.errorType}`);
};

/**
 * Keep the real provider credential inside Electron main. Kimi receives only
 * an operation-local credential for this loopback relay, so Bash/MCP children
 * cannot print the upstream key into Kimi transcripts or LobeHub traces.
 */
export const startProviderBindingProxy = async ({
  apiKey,
  endpoint,
  protocol,
}: StartProviderBindingProxyParams): Promise<ProviderBindingProxy> => {
  const clientApiKey = randomBytes(32).toString('base64url');
  const route = resolveProxyRoute(protocol, endpoint);
  const activeRequests = new Set<AbortController>();

  const server = createServer((incoming, response) => {
    void (async () => {
      const requestURL = new URL(incoming.url ?? '/', 'http://127.0.0.1');
      if (incoming.method !== 'POST' || requestURL.pathname !== route.requestPath) {
        writeError(response, 404, 'Not found');
        return;
      }

      const headers = buildUpstreamHeaders(incoming.headers, clientApiKey, apiKey);
      if (!headers) {
        writeError(response, 401, 'Unauthorized');
        return;
      }

      const abortController = new AbortController();
      activeRequests.add(abortController);
      response.on('close', () => {
        if (!response.writableEnded) abortController.abort();
      });

      try {
        const upstreamURL = new URL(route.upstreamURL);
        upstreamURL.search = requestURL.search;
        const upstream = await request(upstreamURL, {
          body: incoming,
          headers,
          method: 'POST',
          signal: abortController.signal,
        });
        response.writeHead(upstream.statusCode, copyHeaders(upstream.headers));
        await pipeline(upstream.body, response);
      } catch (error) {
        if (!abortController.signal.aborted) {
          writeProviderRequestFailure(response, error, protocol, route.upstreamURL.origin);
        }
      } finally {
        activeRequests.delete(abortController);
      }
    })().catch((error) =>
      writeProviderRequestFailure(response, error, protocol, route.upstreamURL.origin),
    );
  });

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once('error', handleError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', handleError);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  let closePromise: Promise<void> | undefined;
  const abortRequests = () => {
    for (const controller of activeRequests) controller.abort();
    activeRequests.clear();
  };
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closePromise = new Promise((resolve) => {
      server.close(() => resolve());
      abortRequests();
      server.closeAllConnections();
    });
    return closePromise;
  };
  const closeSync = (): void => {
    if (closePromise) return;
    server.close();
    abortRequests();
    server.closeAllConnections();
    closePromise = Promise.resolve();
  };

  return {
    clientApiKey,
    close,
    closeSync,
    endpoint: `http://127.0.0.1:${address.port}${route.clientBasePath}`,
  };
};
