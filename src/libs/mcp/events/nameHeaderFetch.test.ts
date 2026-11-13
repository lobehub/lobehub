import type { FetchLike } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';

import { encodeMcpEventName, nameHeaderFetch } from './nameHeaderFetch';

const params = (name: string, modern = true) => ({
  name,
  ...(modern && { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }),
});

describe('nameHeaderFetch', () => {
  it.each(['events/subscribe', 'events/unsubscribe'])(
    'patches %s while preserving auth and body',
    async (method) => {
      const fetcher = vi.fn<FetchLike>().mockResolvedValue(new Response());
      const body = JSON.stringify({ method, params: params('issue.created') });
      await nameHeaderFetch(fetcher)('https://example.com/mcp', {
        method: 'POST',
        body,
        headers: { authorization: 'Bearer token' },
      });
      const init = fetcher.mock.calls[0][1];
      expect(new Headers(init?.headers).get('mcp-name')).toBe('issue.created');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token');
      expect(init?.body).toBe(body);
    },
  );
  it.each(['events/list', 'tools/call', 'server/discover'])(
    'leaves %s unchanged',
    async (method) => {
      const fetcher = vi.fn<FetchLike>().mockResolvedValue(new Response());
      const init = {
        body: JSON.stringify({ method, params: params('echo') }),
        headers: { 'mcp-name': 'existing' },
      };
      await nameHeaderFetch(fetcher)('https://example.com/mcp', init);
      expect(fetcher.mock.calls[0][1]).toBe(init);
    },
  );
  it('does not patch legacy requests or malformed JSON', async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(new Response());
    for (const body of [
      JSON.stringify({ method: 'events/subscribe', params: params('echo', false) }),
      'invalid',
    ]) {
      const init = { body };
      await nameHeaderFetch(fetcher)('https://example.com/mcp', init);
      expect(fetcher.mock.lastCall?.[1]).toBe(init);
    }
  });
  it('encodes Unicode, whitespace and sentinel-looking names without ambiguity', () => {
    expect(encodeMcpEventName('issue.created')).toBe('issue.created');
    for (const name of ['告警.发生', ' spaced ', '=?base64?literal?=', 'line\nfeed']) {
      const encoded = encodeMcpEventName(name);
      expect(encoded.startsWith('=?base64?')).toBe(true);
      expect(
        new TextDecoder().decode(
          Uint8Array.from(atob(encoded.slice(9, -2)), (char) => char.charCodeAt(0)),
        ),
      ).toBe(name);
    }
  });
});
