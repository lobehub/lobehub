import { describe, expect, it } from 'vitest';

import { resolveYjsWebSocketUrl } from './collaborationUrl';

describe('resolveYjsWebSocketUrl', () => {
  it('uses localhost while rendering without a browser location', () => {
    expect(resolveYjsWebSocketUrl()).toBe('ws://localhost:12345');
  });

  it('uses the page hostname for an HTTP deployment', () => {
    expect(
      resolveYjsWebSocketUrl(
        {
          host: '203.0.113.10',
          hostname: '203.0.113.10',
          protocol: 'http:',
        },
        undefined,
      ),
    ).toBe('ws://203.0.113.10:12345');
  });

  it('uses secure WebSocket when the page is served over HTTPS', () => {
    expect(
      resolveYjsWebSocketUrl(
        {
          host: 'page.example.com',
          hostname: 'page.example.com',
          protocol: 'https:',
        },
        undefined,
      ),
    ).toBe('wss://page.example.com:12345');
  });

  it('keeps local development on the dedicated Yjs port', () => {
    expect(
      resolveYjsWebSocketUrl(
        {
          host: 'localhost:28168',
          hostname: 'localhost',
          protocol: 'http:',
        },
        undefined,
      ),
    ).toBe('ws://localhost:12345');
  });

  it('prefers an explicitly configured collaboration endpoint', () => {
    expect(
      resolveYjsWebSocketUrl(
        { host: 'page.example.com', hostname: 'page.example.com', protocol: 'https:' },
        'wss://collaboration.example.com/yjs/',
      ),
    ).toBe('wss://collaboration.example.com/yjs');
  });
});
