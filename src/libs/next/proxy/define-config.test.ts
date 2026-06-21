/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import {
  LOBE_ROUTE_VIEW_COOKIE,
  LOBE_ROUTE_VIEW_QUERY,
  RouteViewPreference,
} from '@/const/routeView';
import { DEFAULT_LANG, RouteVariants } from '@/utils/server/routeVariants';

import { defineConfig, resolveIsMobileVariant, resolveRouteViewPreference } from './define-config';

vi.mock('@/auth', () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

const { middleware } = defineConfig();

const run = async (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => {
  const res = await middleware(new NextRequest(url, init));
  return {
    response: res,
    rewrite: res?.headers.get('x-middleware-rewrite'),
  };
};

describe('defineConfig locale path-traversal hardening', () => {
  it('rewrites a normal locale into /spa-auth/<locale>', async () => {
    const { rewrite } = await run('http://localhost:3010/signin?hl=ja-JP');
    expect(new URL(rewrite!).pathname).toBe('/spa-auth/ja-JP/signin');
  });

  it('falls back to en-US for a traversal locale (plain)', async () => {
    const { rewrite } = await run('http://localhost:3010/signin?hl=../../api/dev/x');
    const { pathname } = new URL(rewrite!);
    expect(pathname.startsWith('/spa-auth/')).toBe(true);
    expect(pathname).toBe('/spa-auth/en-US/signin');
  });

  it('falls back to en-US for a traversal locale (percent-encoded)', async () => {
    const { rewrite } = await run('http://localhost:3010/signin?hl=..%2F..%2Fapi%2Fdev%2Fx');
    const { pathname } = new URL(rewrite!);
    expect(pathname.startsWith('/spa-auth/')).toBe(true);
    expect(pathname).toBe('/spa-auth/en-US/signin');
  });
});

describe('defineConfig route view preference', () => {
  it('resolves query preference before cookie preference', () => {
    const url = new URL(`http://localhost:3010/me?${LOBE_ROUTE_VIEW_QUERY}=desktop`);

    expect(resolveRouteViewPreference(url, RouteViewPreference.Mobile)).toBe(
      RouteViewPreference.Desktop,
    );
  });

  it('ignores invalid route view preferences', () => {
    const url = new URL(`http://localhost:3010/me?${LOBE_ROUTE_VIEW_QUERY}=tablet`);

    expect(resolveRouteViewPreference(url, 'watch')).toBeUndefined();
  });

  it('uses desktop preference to override mobile user-agent routing', () => {
    expect(
      resolveIsMobileVariant({
        isMobileDevice: true,
        isSharePath: false,
        routeViewPreference: RouteViewPreference.Desktop,
      }),
    ).toBe(false);
  });

  it('uses mobile preference to override desktop user-agent routing', () => {
    expect(
      resolveIsMobileVariant({
        isMobileDevice: false,
        isSharePath: false,
        routeViewPreference: RouteViewPreference.Mobile,
      }),
    ).toBe(true);
  });

  it('rewrites mobile user-agent SPA requests to desktop when query preference is desktop', async () => {
    const desktopRoute = RouteVariants.serializeVariants({ isMobile: false, locale: DEFAULT_LANG });
    const { response, rewrite } = await run(
      `http://localhost:3010/verify/example?tab=profile&${LOBE_ROUTE_VIEW_QUERY}=desktop`,
      {
        headers: {
          'user-agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        },
      },
    );
    const rewriteUrl = new URL(rewrite!, 'http://localhost:3010');

    expect(rewriteUrl.pathname).toBe(`/spa/${desktopRoute}/verify/example`);
    expect(rewriteUrl.searchParams.get(LOBE_ROUTE_VIEW_QUERY)).toBeNull();
    expect(response?.headers.get('set-cookie')).toContain(
      `${LOBE_ROUTE_VIEW_COOKIE}=${RouteViewPreference.Desktop}`,
    );
  });

  it('rewrites mobile user-agent SPA requests to desktop when cookie preference is desktop', async () => {
    const desktopRoute = RouteVariants.serializeVariants({ isMobile: false, locale: DEFAULT_LANG });
    const { rewrite } = await run('http://localhost:3010/verify/example?tab=profile', {
      headers: {
        'cookie': `${LOBE_ROUTE_VIEW_COOKIE}=${RouteViewPreference.Desktop}`,
        'user-agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      },
    });

    expect(new URL(rewrite!, 'http://localhost:3010').pathname).toBe(
      `/spa/${desktopRoute}/verify/example`,
    );
  });
});
