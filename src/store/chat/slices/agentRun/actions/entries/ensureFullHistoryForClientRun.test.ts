import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isPartialHeadWindow } from '@/services/message/roundCursorPage';
import { displayMessageSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';

import { readClientRunMessages } from './ensureFullHistoryForClientRun';

vi.mock('@/services/message/roundCursorPage', () => ({ isPartialHeadWindow: vi.fn() }));
vi.mock('@/store/chat/selectors', () => ({
  displayMessageSelectors: { getDisplayMessagesByKey: vi.fn() },
}));

const context = { agentId: 'agt_1', scope: 'main', topicId: 'tpc_1' } as const;

const setup = () => {
  let messages = [{ id: 'msg_newest' }];
  const store = {
    refreshMessages: vi.fn(async () => {
      messages = [{ id: 'msg_oldest' }, { id: 'msg_newest' }];
    }),
  } as unknown as ChatStore;
  vi.mocked(displayMessageSelectors.getDisplayMessagesByKey).mockImplementation(
    () => () => messages as any,
  );
  return { get: () => store, store };
};

describe('readClientRunMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the whole history once a partial head window has been re-read', async () => {
    vi.mocked(isPartialHeadWindow).mockReturnValue(true);
    const { get, store } = setup();

    const messages = await readClientRunMessages(get, context, 'main_agt_1_tpc_1');

    expect(store.refreshMessages).toHaveBeenCalledWith(context);
    expect(messages.map((message) => message.id)).toEqual(['msg_oldest', 'msg_newest']);
    expect(displayMessageSelectors.getDisplayMessagesByKey).toHaveBeenCalledWith(
      'main_agt_1_tpc_1',
    );
  });

  it('reads the loaded messages as they are when the window is already complete', async () => {
    vi.mocked(isPartialHeadWindow).mockReturnValue(false);
    const { get, store } = setup();

    const messages = await readClientRunMessages(get, context, 'main_agt_1_tpc_1');

    expect(store.refreshMessages).not.toHaveBeenCalled();
    expect(messages.map((message) => message.id)).toEqual(['msg_newest']);
  });
});
