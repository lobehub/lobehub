import { describe, expect, it } from 'vitest';

import { isAlwaysWorkbenchSpaRoute, isWorkbenchSpaRoute } from './workbenchRoutes';

describe('isAlwaysWorkbenchSpaRoute', () => {
  it.each(['/verify', '/verify/run-1'])('owns verify for every UA: %s', (pathname) => {
    expect(isAlwaysWorkbenchSpaRoute(pathname)).toBe(true);
  });

  it.each([
    '/acceptance',
    '/acceptance/acceptance-1',
    '/agent/agt_1/docs/doc_1',
    '/verify-im',
    '/share/t/topic-1',
  ])('leaves other Workbench-or-SPA routes alone: %s', (pathname) => {
    expect(isAlwaysWorkbenchSpaRoute(pathname)).toBe(false);
  });
});

describe('isWorkbenchSpaRoute', () => {
  it.each([
    '/agent/agt_9GOn6nUgGw35/docs/TWuw2YunjhwLblZ7',
    '/agent/agt_9GOn6nUgGw35/docs/TWuw2YunjhwLblZ7/',
    '/verify',
    '/verify/',
    '/verify/run-1',
  ])('matches a Workbench-owned route: %s', (pathname) => {
    expect(isWorkbenchSpaRoute(pathname)).toBe(true);
  });

  it.each([
    '/agent/agt_9GOn6nUgGw35',
    '/agent/agt_9GOn6nUgGw35/docs',
    '/agent/agt_9GOn6nUgGw35/docs/doc-1/history',
    '/acceptance',
    '/acceptance/acceptance-1',
    '/acceptance/acceptance-1/check/check-1',
    '/acceptance-preview',
    '/acceptance/acceptance-1/history',
    '/workspace/acceptance/acceptance-1',
    '/verify-im',
    '/verify-email',
  ])('does not broaden ownership beyond the declared routes: %s', (pathname) => {
    expect(isWorkbenchSpaRoute(pathname)).toBe(false);
  });
});
