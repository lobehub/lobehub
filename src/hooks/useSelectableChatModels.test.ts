import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelectableChatModels } from './useSelectableChatModels';

const { guard, enabledList } = vi.hoisted(() => ({
  enabledList: [
    {
      children: [{ id: 'mini' }, { id: 'opus' }],
      id: 'lobehub',
    },
    { children: [{ id: 'opus' }], id: 'openai' },
  ],
  guard: { current: {} as { isModelHidden?: (model: string, provider: string) => boolean } },
}));

vi.mock('./useEnabledChatModels', () => ({ useEnabledChatModels: () => enabledList }));
vi.mock('@/business/client/hooks/useBusinessModelListGuard', () => ({
  useBusinessModelListGuard: () => guard.current,
}));

describe('useSelectableChatModels', () => {
  beforeEach(() => {
    guard.current = {};
  });

  it('returns the enabled list unchanged without a hiding policy', () => {
    const { result } = renderHook(() => useSelectableChatModels());
    expect(result.current).toBe(enabledList);
  });

  it('leaves out the models the business policy hides, per provider', () => {
    guard.current = {
      isModelHidden: (model, provider) => provider === 'lobehub' && model === 'opus',
    };
    const { result } = renderHook(() => useSelectableChatModels());

    expect(result.current.map((p) => [p.id, p.children.map((m) => m.id)])).toEqual([
      ['lobehub', ['mini']],
      ['openai', ['opus']],
    ]);
  });
});
