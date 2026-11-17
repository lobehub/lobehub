import { toRecord } from '@lobechat/utils/object';
import type { FetchLike } from '@modelcontextprotocol/client';

/** Match SEP-2243's sentinel encoding, including a literal sentinel-looking ASCII name. */
export const encodeMcpEventName = (name: string) =>
  /^[\x20-\x7E]*$/.test(name) && name === name.trim() && !name.startsWith('=?base64?')
    ? name
    : `=?base64?${btoa(Array.from(new TextEncoder().encode(name), (byte) => String.fromCodePoint(byte)).join(''))}?=`;

/** SDK 2.4's reserved Mcp-Name header table lacks events methods. Patch at transport fetch. */
export const nameHeaderFetch =
  (
    fetcher: FetchLike = globalThis.fetch,
    onDiscoverCapabilities?: (capabilities: unknown) => void,
  ): FetchLike =>
  async (input, init) => {
    let request: Record<string, unknown> = {};
    if (typeof init?.body === 'string') {
      try {
        request = toRecord(JSON.parse(init.body)) ?? {};
      } catch {
        /* A non-JSON fetch is passed through unchanged. */
      }
    }
    const params = toRecord(request.params) ?? {};
    const meta = toRecord(params._meta) ?? {};
    const modern = typeof meta['io.modelcontextprotocol/protocolVersion'] === 'string';
    if (
      modern &&
      (request.method === 'events/subscribe' || request.method === 'events/unsubscribe') &&
      typeof params.name === 'string'
    ) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.set('Mcp-Name', encodeMcpEventName(params.name));
      init = { ...init, headers };
    }
    const response = await fetcher(input, init);
    if (
      request.method === 'server/discover' &&
      response.ok &&
      onDiscoverCapabilities &&
      response.headers.get('content-type')?.includes('application/json')
    ) {
      const raw: unknown = await response.clone().json();
      onDiscoverCapabilities(toRecord(toRecord(raw)?.result)?.capabilities);
    }
    return response;
  };
