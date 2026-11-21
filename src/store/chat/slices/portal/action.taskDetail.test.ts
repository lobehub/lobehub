import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

describe('portal openTaskDetail', () => {
  it('keeps the owning workspace of a task from another workspace', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.openTaskDetail('T-198', { id: 'ws-1', slug: 'lobe-team' });
    });
    expect(chatPortalSelectors.taskDetailWorkspace(result.current)).toEqual({
      id: 'ws-1',
      slug: 'lobe-team',
    });

    // Replacing it with an active-scope task drops the foreign scope.
    act(() => {
      result.current.openTaskDetail('T-7');
    });
    expect(chatPortalSelectors.taskDetailId(result.current)).toBe('T-7');
    expect(chatPortalSelectors.taskDetailWorkspace(result.current)).toBeUndefined();
  });
});
