/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCanManageAccountPool } from './useCanManageAccountPool';

const permission = vi.hoisted(() => ({ allowed: true, calls: [] as string[] }));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: string) => {
    permission.calls.push(action);
    return { allowed: permission.allowed };
  },
}));

describe('useCanManageAccountPool', () => {
  it('follows the settings permission, which the Subscription Accounts page requires', () => {
    permission.allowed = true;
    expect(renderHook(() => useCanManageAccountPool()).result.current).toBe(true);
    expect(permission.calls.at(-1)).toBe('manage_settings');
  });

  // Regression: a workspace member without settings access was sent to an
  // admin-only page and got a 403.
  it('is false for a member who cannot manage settings', () => {
    permission.allowed = false;
    expect(renderHook(() => useCanManageAccountPool()).result.current).toBe(false);
  });
});
