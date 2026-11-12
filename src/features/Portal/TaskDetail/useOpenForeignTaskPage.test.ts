/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useOpenForeignTaskPage } from './useOpenForeignTaskPage';

const calls: string[] = [];
const navigate = vi.fn(() => calls.push('navigate'));
const clearPortalStack = vi.fn(() => calls.push('clearPortalStack'));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({ clearPortalStack }),
}));

describe('useOpenForeignTaskPage', () => {
  it('closes the read-only panel before entering the task page in its workspace', () => {
    const { result } = renderHook(() => useOpenForeignTaskPage());

    result.current('/lobe-team/task/T-198/ship-it');

    expect(navigate).toHaveBeenCalledWith('/lobe-team/task/T-198/ship-it', { escape: true });
    expect(calls).toEqual(['clearPortalStack', 'navigate']);
  });
});
