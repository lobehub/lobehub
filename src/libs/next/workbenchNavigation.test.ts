import { describe, expect, it } from 'vitest';

import { shouldHardNavigateToWorkbench } from './workbenchNavigation';

describe('shouldHardNavigateToWorkbench', () => {
  it.each(['/verify', '/verify/run-1'])(
    'hard-navigates verify out of the main web SPA: %s',
    (pathname) => {
      expect(shouldHardNavigateToWorkbench(pathname)).toBe(true);
    },
  );

  it.each([
    '/acceptance',
    '/acceptance/a-1?r=2',
    '/verify-im',
    '/agent/agt_1/docs/doc_1',
    '/settings/profile',
  ])('keeps other main-SPA destinations in-router: %s', (pathname) => {
    expect(shouldHardNavigateToWorkbench(pathname)).toBe(false);
  });
});
