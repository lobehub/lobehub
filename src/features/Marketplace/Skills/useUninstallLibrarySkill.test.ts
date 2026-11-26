import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUninstallLibrarySkill } from './useUninstallLibrarySkill';

const deleteAgentSkill = vi.fn();

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (s: unknown) => unknown) => selector({ deleteAgentSkill }),
}));

describe('useUninstallLibrarySkill', () => {
  beforeEach(() => {
    deleteAgentSkill.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('reports a failed uninstall instead of finishing silently', async () => {
    deleteAgentSkill.mockRejectedValueOnce(new Error('500'));
    const { result } = renderHook(() => useUninstallLibrarySkill('skill-1'));

    await act(() => result.current.uninstall());

    expect(deleteAgentSkill).toHaveBeenCalledWith('skill-1');
    expect(result.current.failed).toBe(true);
    expect(result.current.removing).toBe(false);
  });

  it('clears the failure when a retry succeeds', async () => {
    deleteAgentSkill.mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useUninstallLibrarySkill('skill-1'));

    await act(() => result.current.uninstall());
    await act(() => result.current.uninstall());

    expect(result.current.failed).toBe(false);
  });
});
