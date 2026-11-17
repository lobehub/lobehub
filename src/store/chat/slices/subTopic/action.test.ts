import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatSubTopicActionImpl } from './action';

const mocks = vi.hoisted(() => ({
  archive: vi.fn(),
  trash: vi.fn(),
}));

vi.mock('@/services/subTopic', () => ({
  subTopicService: { archive: mocks.archive, listOpened: vi.fn(), trash: mocks.trash },
}));

const createAction = (activeTopicId: string | null) => {
  const store = {
    activeTopicId,
    refreshTopic: vi.fn().mockResolvedValue(undefined),
    switchTopic: vi.fn(),
  };
  const action = new ChatSubTopicActionImpl(vi.fn() as any, () => store as any);
  return { action, store };
};

describe('ChatSubTopicActionImpl.retireTopicTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.archive.mockResolvedValue({ detached: [], retired: ['tpc_child', 'tpc_parent'] });
    mocks.trash.mockResolvedValue({ detached: [], retired: ['tpc_parent'] });
  });

  it('closes an open sub-topic that "archive all" retired along with its parent', async () => {
    const { action, store } = createAction('tpc_child');

    await action.retireTopicTree('tpc_parent', 'archive', 'all');

    expect(store.switchTopic).toHaveBeenCalledWith(null);
    expect(store.refreshTopic).toHaveBeenCalled();
  });

  it('keeps an open conversation that was not retired', async () => {
    const { action, store } = createAction('tpc_other');

    await action.retireTopicTree('tpc_parent', 'archive', 'all');

    expect(store.switchTopic).not.toHaveBeenCalled();
  });

  it('passes the attachment choice to the tree deletion', async () => {
    const { action } = createAction(null);

    await action.retireTopicTree('tpc_parent', 'trash', 'self', { removeFiles: false });

    expect(mocks.trash).toHaveBeenCalledWith('tpc_parent', 'self', false);
  });
});
