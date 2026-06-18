/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { defineConfig } from './define-config';

vi.mock('@/auth', () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

const { middleware } = defineConfig();

const run = async (url: string) => {
  const res = await middleware(new NextRequest(url));
  return res?.headers.get('x-middleware-rewrite');
};

describe('defineConfig locale path-traversal hardening', () => {
  it('rewrites a normal locale into /spa-auth/<locale>', async () => {
    const rewrite = await run('http://localhost:3010/signin?hl=ja-JP');
    expect(new URL(rewrite!).pathname).toBe('/spa-auth/ja-JP/signin');
  });

  it('falls back to en-US for a traversal locale (plain)', async () => {
    const rewrite = await run('http://localhost:3010/signin?hl=../../api/dev/x');
    const { pathname } = new URL(rewrite!);
    expect(pathname.startsWith('/spa-auth/')).toBe(true);
    expect(pathname).toBe('/spa-auth/en-US/signin');
  });

  it('falls back to en-US for a traversal locale (percent-encoded)', async () => {
    const rewrite = await run('http://localhost:3010/signin?hl=..%2F..%2Fapi%2Fdev%2Fx');
    const { pathname } = new URL(rewrite!);
    expect(pathname.startsWith('/spa-auth/')).toBe(true);
    expect(pathname).toBe('/spa-auth/en-US/signin');
  });
});
