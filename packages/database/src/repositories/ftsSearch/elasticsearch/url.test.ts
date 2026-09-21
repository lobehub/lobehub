// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { parseElasticsearchUrl, resolveElasticsearchTransport } from './url';

describe('parseElasticsearchUrl', () => {
  it('accepts HTTPS and loopback HTTP endpoints by default', () => {
    expect(parseElasticsearchUrl('https://search.example.com').hostname).toBe('search.example.com');
    expect(parseElasticsearchUrl('http://localhost:9200').port).toBe('9200');
    expect(parseElasticsearchUrl('http://127.0.0.1:9200').hostname).toBe('127.0.0.1');
  });

  it('rejects plaintext HTTP to a non-loopback host by default', () => {
    expect(() => parseElasticsearchUrl('http://elasticsearch:9200')).toThrow(
      'Elasticsearch URL must use HTTPS unless it targets loopback',
    );
  });

  it('allows plaintext HTTP to a private-network host only when explicitly enabled', () => {
    expect(
      parseElasticsearchUrl('http://elasticsearch:9200', { allowInsecureHttp: true }).hostname,
    ).toBe('elasticsearch');
    expect(() =>
      parseElasticsearchUrl('http://elasticsearch:9200', { allowInsecureHttp: false }),
    ).toThrow('must use HTTPS unless it targets loopback');
  });

  it('never accepts embedded credentials or non-HTTP schemes', () => {
    expect(() =>
      parseElasticsearchUrl('http://elastic:secret@elasticsearch:9200', {
        allowInsecureHttp: true,
      }),
    ).toThrow('must not contain embedded credentials');
    expect(() =>
      parseElasticsearchUrl('ftp://elasticsearch:9200', { allowInsecureHttp: true }),
    ).toThrow('must use HTTPS unless it targets loopback');
    expect(() => parseElasticsearchUrl('not a url')).toThrow('must be a valid absolute URL');
  });
});

describe('resolveElasticsearchTransport', () => {
  it('sends an API key over HTTPS', () => {
    expect(
      resolveElasticsearchTransport({ apiKey: 'secret', url: 'https://search.example.com' }),
    ).toEqual({
      authorizationHeader: 'ApiKey secret',
      url: new URL('https://search.example.com'),
    });
  });

  it('requires an API key unless insecure private-network access is explicitly enabled', () => {
    expect(() => resolveElasticsearchTransport({ url: 'https://search.example.com' })).toThrow(
      'Elasticsearch API key is required unless ES_ALLOW_INSECURE_HTTP=true',
    );
    expect(() =>
      resolveElasticsearchTransport({ apiKey: '', url: 'https://search.example.com' }),
    ).toThrow('Elasticsearch API key is required unless ES_ALLOW_INSECURE_HTTP=true');
    expect(() => resolveElasticsearchTransport({ url: 'http://elasticsearch:9200' })).toThrow(
      'must use HTTPS unless it targets loopback',
    );
  });

  it('omits the Authorization header for an explicitly insecure private-network endpoint', () => {
    expect(
      resolveElasticsearchTransport({
        allowInsecureHttp: true,
        url: 'http://elasticsearch:9200',
      }),
    ).toEqual({ authorizationHeader: undefined, url: new URL('http://elasticsearch:9200') });
  });

  it('never sends an API key over plaintext HTTP to a non-loopback host', () => {
    expect(() =>
      resolveElasticsearchTransport({
        allowInsecureHttp: true,
        apiKey: 'secret',
        url: 'http://elasticsearch:9200',
      }),
    ).toThrow('Elasticsearch API key must not be sent over plaintext HTTP');
  });

  it('keeps the loopback development path with an API key working', () => {
    expect(
      resolveElasticsearchTransport({ apiKey: 'secret', url: 'http://localhost:9200' }),
    ).toEqual({ authorizationHeader: 'ApiKey secret', url: new URL('http://localhost:9200') });
  });

  it('still uses an API key over HTTPS when insecure HTTP is allowed but unused', () => {
    expect(
      resolveElasticsearchTransport({
        allowInsecureHttp: true,
        apiKey: 'secret',
        url: 'https://search.example.com',
      }),
    ).toEqual({
      authorizationHeader: 'ApiKey secret',
      url: new URL('https://search.example.com'),
    });
  });
});
