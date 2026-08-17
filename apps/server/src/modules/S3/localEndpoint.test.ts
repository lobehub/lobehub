// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { ensureLocalNoProxyEnv, isLocalS3Endpoint, resolveS3SdkEndpoint } from './localEndpoint';

describe('isLocalS3Endpoint', () => {
  it('treats loopback RustFS URLs as local', () => {
    expect(isLocalS3Endpoint('http://localhost:9000')).toBe(true);
    expect(isLocalS3Endpoint('http://127.0.0.1:9000')).toBe(true);
    expect(isLocalS3Endpoint('http://[::1]:9000')).toBe(true);
  });

  it('treats remote object storage as non-local', () => {
    expect(isLocalS3Endpoint('https://s3.amazonaws.com')).toBe(false);
    expect(isLocalS3Endpoint('https://s3.example.com')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(isLocalS3Endpoint('not-a-url')).toBe(false);
  });
});

describe('ensureLocalNoProxyEnv', () => {
  const previousNoProxy = process.env.NO_PROXY;
  const previousNoProxyLower = process.env.no_proxy;

  afterEach(() => {
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
    if (previousNoProxyLower === undefined) delete process.env.no_proxy;
    else process.env.no_proxy = previousNoProxyLower;
  });

  it('adds loopback hosts without dropping existing entries', () => {
    process.env.NO_PROXY = 'example.com';
    delete process.env.no_proxy;

    ensureLocalNoProxyEnv();

    expect(process.env.NO_PROXY).toContain('example.com');
    expect(process.env.NO_PROXY).toContain('localhost');
    expect(process.env.NO_PROXY).toContain('127.0.0.1');
    expect(process.env.no_proxy).toBe(process.env.NO_PROXY);
  });

  it('leaves a wildcard NO_PROXY unchanged', () => {
    process.env.NO_PROXY = '*';
    delete process.env.no_proxy;

    ensureLocalNoProxyEnv();

    expect(process.env.NO_PROXY).toBe('*');
  });
});

describe('resolveS3SdkEndpoint', () => {
  it('prefers the Docker-internal RustFS URL when set', () => {
    expect(resolveS3SdkEndpoint('http://localhost:9000', 'http://rustfs:9000')).toBe(
      'http://rustfs:9000',
    );
  });

  it('keeps the public endpoint when no internal URL is set', () => {
    expect(resolveS3SdkEndpoint('http://localhost:9000')).toBe('http://localhost:9000');
  });
});
