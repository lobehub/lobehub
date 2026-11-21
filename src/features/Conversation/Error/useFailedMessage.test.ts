import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dataSelectors } from '@/features/Conversation/store/slices/data/selectors';

import { useFailedMessage } from './useFailedMessage';

const storeMock = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('@/features/Conversation/store', () => ({
  dataSelectors,
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(storeMock.state),
}));

const blockError = { message: 'upstream timed out', type: 'InternalServerError' };

describe('useFailedMessage', () => {
  beforeEach(() => {
    storeMock.state = {
      // An assistant group shows up as one top-level row; its failed step is a child block.
      dbMessages: [
        {
          error: blockError,
          id: 'msg_block',
          model: 'gpt-x',
          provider: 'openai',
          role: 'assistant',
        },
      ],
      displayMessages: [
        { children: [{ id: 'msg_block' }], id: 'msg_group', role: 'assistantGroup' },
      ],
    };
  });

  it('resolves a failed block inside an assistant group', () => {
    const { result } = renderHook(() => useFailedMessage('msg_block'));

    expect(result.current).toMatchObject({
      error: blockError,
      model: 'gpt-x',
      provider: 'openai',
    });
  });

  it('falls back to display messages that have no stored row', () => {
    storeMock.state.displayMessages = [{ id: 'msg_member', model: 'gpt-y', role: 'assistant' }];

    const { result } = renderHook(() => useFailedMessage('msg_member'));

    expect(result.current).toMatchObject({ model: 'gpt-y' });
  });
});
