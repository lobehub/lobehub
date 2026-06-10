import { describe, expect, it } from 'vitest';

import { getAvailableSidebarItems } from './CustomizeSidebarModal';

describe('CustomizeSidebarModal', () => {
  it('keeps Memory available in personal mode', () => {
    const items = getAvailableSidebarItems(false);

    expect(items.some((item) => item.id === 'memory')).toBe(true);
  });

  it('removes Memory from workspace mode customization', () => {
    const items = getAvailableSidebarItems(true);

    expect(items.some((item) => item.id === 'memory')).toBe(false);
  });
});
