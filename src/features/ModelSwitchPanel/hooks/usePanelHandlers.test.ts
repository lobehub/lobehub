import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePanelHandlers } from './usePanelHandlers';

const mocks = vi.hoisted(() => ({
  allowed: true,
  updateAgentConfig: vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.allowed }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (
    selector: (state: { updateAgentConfig: typeof mocks.updateAgentConfig }) => unknown,
  ) => selector({ updateAgentConfig: mocks.updateAgentConfig }),
}));

describe('usePanelHandlers', () => {
  beforeEach(() => {
    mocks.allowed = true;
    mocks.updateAgentConfig.mockReset();
  });

  it('commits the selected model before returning so an immediate send observes it', () => {
    const onModelChange = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePanelHandlers({ onModelChange }));

    act(() => result.current.handleModelChange('deepseek-chat', 'deepseek'));

    expect(onModelChange).toHaveBeenCalledWith({
      model: 'deepseek-chat',
      provider: 'deepseek',
    });
  });

  it('does not update the model without create-content permission', () => {
    mocks.allowed = false;
    const onModelChange = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePanelHandlers({ onModelChange }));

    act(() => result.current.handleModelChange('deepseek-chat', 'deepseek'));

    expect(onModelChange).not.toHaveBeenCalled();
  });
});
