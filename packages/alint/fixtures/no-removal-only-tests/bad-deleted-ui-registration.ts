import { expect, it } from 'vitest';

import { navigationItems } from './navigation';

// The legacy dashboard registration and page implementation were deleted.
// alint-expect
it('confirms the removed dashboard is absent from navigation', () => {
  expect(navigationItems.map((item) => item.id)).not.toContain('legacy-dashboard');
});
