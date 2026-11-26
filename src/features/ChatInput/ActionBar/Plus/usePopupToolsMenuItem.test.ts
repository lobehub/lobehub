import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePopupToolsMenuItem } from './usePopupToolsMenuItem';

const mocks = vi.hoisted(() => ({
  useToolsControls: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../Tools/useControls', () => ({
  useControls: mocks.useToolsControls,
}));

describe('usePopupToolsMenuItem', () => {
  beforeEach(() => {
    mocks.useToolsControls.mockReset();
    mocks.useToolsControls.mockReturnValue({
      isPolicyMenuOpen: false,
      marketFooter: 'footer',
      marketHeader: 'header',
      marketItems: [
        {
          key: 'lobe-web-browsing',
          label: 'Web Browsing',
          popoverContent: 'detail',
        },
      ],
    });
  });

  it('builds an inline Tools submenu for popup chats without unmounted WorkingSidebar', () => {
    const closeDropdown = vi.fn();
    const { result } = renderHook(() => usePopupToolsMenuItem(closeDropdown));

    expect(mocks.useToolsControls).toHaveBeenCalledWith({ closeDropdown });
    expect(result.current.key).toBe('tools');
    expect((result.current as { header?: unknown }).header).toBe('header');
    expect((result.current as { footer?: unknown }).footer).toBe('footer');
    const children = (result.current as { children?: Array<Record<string, unknown>> }).children;
    expect(children).toHaveLength(1);
    expect(children?.[0]?.key).toBe('lobe-web-browsing');
    expect(children?.[0]).not.toHaveProperty('popoverContent');
  });
});
