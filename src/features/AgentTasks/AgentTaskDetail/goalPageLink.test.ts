import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasGoalPage } from './goalPageLink';

describe('hasGoalPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true on the desktop/web bundle', () => {
    vi.stubGlobal('__MOBILE__', false);
    expect(hasGoalPage()).toBe(true);
  });

  it('is false on the mobile bundle regardless of viewport width', () => {
    vi.stubGlobal('__MOBILE__', true);
    expect(hasGoalPage()).toBe(false);
  });
});
