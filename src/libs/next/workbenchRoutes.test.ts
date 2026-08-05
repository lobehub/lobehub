import { describe, expect, it } from 'vitest';

import { isWorkbenchSpaRoute } from './workbenchRoutes';

describe('isWorkbenchSpaRoute', () => {
  it.each([
    '/agent/agt_9GOn6nUgGw35/docs/TWuw2YunjhwLblZ7',
    '/agent/agt_9GOn6nUgGw35/docs/TWuw2YunjhwLblZ7/',
    '/acceptance',
    '/acceptance/',
    '/acceptance/acceptance-1',
    '/acceptance/acceptance-1?round=2',
    '/acceptance/acceptance-1/check/check-1',
  ])('matches a Workbench-owned route: %s', (pathname) => {
    expect(isWorkbenchSpaRoute(pathname)).toBe(true);
  });

  it.each([
    '/agent/agt_9GOn6nUgGw35',
    '/agent/agt_9GOn6nUgGw35/docs',
    '/agent/agt_9GOn6nUgGw35/docs/doc-1/history',
    '/acceptance-preview',
    '/acceptance/acceptance-1/history',
    '/workspace/acceptance/acceptance-1',
  ])('does not broaden ownership beyond the declared routes: %s', (pathname) => {
    expect(isWorkbenchSpaRoute(pathname)).toBe(false);
  });
});
