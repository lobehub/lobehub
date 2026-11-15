import { isSSRFBlockedError, ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { toRecord } from '@lobechat/utils/object';
import type { FetchLike } from '@modelcontextprotocol/client';

import { createMCPError, type MCPError } from './types';

/**
 * The fetch every server-side MCP HTTP request goes through: the transport's
 * POST / GET (SSE) / DELETE requests, the redirects it follows, and the OAuth
 * discovery, registration and token requests for a connector.
 *
 * The URL is chosen by whoever configured the MCP server, and the response is
 * returned to them, so the address is checked against the SSRF policy where the
 * connection is made: the IP each hop actually resolves to, not the URL text.
 * Private, loopback, link-local (cloud metadata) and other reserved addresses
 * are refused unless `SSRF_ALLOW_PRIVATE_IP_ADDRESS` / `SSRF_ALLOW_IP_ADDRESS_LIST`
 * allow them (a self-hosted server that reaches its LAN directly).
 *
 * Server only: the Desktop main process has its own MCP client, which runs on
 * the user's machine and must reach localhost and the LAN.
 */
export const mcpSsrfSafeFetch: FetchLike = (url, init) => ssrfSafeFetch(url.toString(), init);

export const MCP_SSRF_BLOCKED_MESSAGE =
  'The MCP server address resolves to a private, loopback, link-local or otherwise reserved IP address, so the request was refused by the server security policy (SSRF protection). Use a publicly reachable MCP server URL. On a self-hosted deployment that must reach this address, allow it with SSRF_ALLOW_PRIVATE_IP_ADDRESS or SSRF_ALLOW_IP_ADDRESS_LIST.';

/** The structured MCP error for a request the SSRF policy refused. */
export const createMCPSSRFBlockedError = (error: unknown): MCPError =>
  createMCPError('SSRF_BLOCKED', MCP_SSRF_BLOCKED_MESSAGE, {
    originalError: error instanceof Error ? error.message : String(error),
  });

/**
 * Whether `error` is (or wraps, through `cause`) a request the SSRF policy
 * refused: the raw fetch error, or the structured MCP error made from it.
 */
export const isMCPSSRFBlockedError = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    if (toRecord(toRecord(current)?.data)?.type === 'SSRF_BLOCKED') return true;
    seen.add(current);
    current = toRecord(current)?.cause;
  }
  return isSSRFBlockedError(error);
};
