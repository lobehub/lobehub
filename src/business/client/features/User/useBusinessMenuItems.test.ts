import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import useBusinessMenuItems from './useBusinessMenuItems';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children, to }: { children: React.ReactNode; to: string }) =>
    createElement('a', { href: to }, children),
}));

describe('useBusinessMenuItems', () => {
  it('returns no items when signed out', () => {
    const { result } = renderHook(() => useBusinessMenuItems(false));
    expect(result.current).toEqual([]);
  });

  it('exposes wallet, org, and platform links when signed in', () => {
    const { result } = renderHook(() => useBusinessMenuItems(true));
    const keys = (result.current ?? []).map((item) =>
      item && typeof item === 'object' && 'key' in item ? item.key : undefined,
    );

    expect(keys).toContain('aico-wallet');
    expect(keys).toContain('aico-org');
    expect(keys).toContain('aico-platform');
  });
});
