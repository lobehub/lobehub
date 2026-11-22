import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatSubTopicActionImpl, retirableSubTopics } from './action';

const mocks = vi.hoisted(() => ({
  archiveTopicTree: vi.fn(),
  detachFromParent: vi.fn(),
  listChildTopics: vi.fn(),
  removeTopicTree: vi.fn(),
}));

vi.mock('@/services/topic', () => ({ topicService: mocks }));

const row = (id: string, parent: string, extra: Record<string, unknown> = {}) =>
  ({
    agent: { title: `Agent of ${id}` },
    agentId: 'agt_parent',
    id,
    openedBy: { agentId: 'agt_parent', topicId: parent },
    state: 'idle',
    trigger: null,
    ...extra,
  }) as any;

const createAction = (activeTopicId: string | null, treeMap: Record<string, any[]> = {}) => {
  const store = {
    activeTopicId,
    refreshTopic: vi.fn().mockResolvedValue(undefined),
    subTopicTreeMap: treeMap,
    switchTopic: vi.fn(),
  };
  const action = new ChatSubTopicActionImpl(vi.fn() as any, () => store as any);
  return { action, store };
};

describe('ChatSubTopicActionImpl.retireTopicTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listChildTopics.mockResolvedValue([
      row('tpc_child', 'tpc_parent'),
      row('tpc_cross', 'tpc_parent', { agentId: 'agt_codex' }),
      row('tpc_grand', 'tpc_child'),
    ]);
  });

  it('archives the whole tree through the topic entry and closes a retired open sub-topic', async () => {
    const { action, store } = createAction('tpc_grand');

    const result = await action.retireTopicTree('tpc_parent', 'archive', 'all');

    expect(mocks.archiveTopicTree).toHaveBeenCalledWith('tpc_parent', 'all');
    expect(result.retired.sort()).toEqual(['tpc_child', 'tpc_cross', 'tpc_grand', 'tpc_parent']);
    expect(store.switchTopic).toHaveBeenCalledWith(null);
    expect(store.refreshTopic).toHaveBeenCalled();
  });

  it('keeps an open conversation that was not retired', async () => {
    const { action, store } = createAction('tpc_other');

    await action.retireTopicTree('tpc_parent', 'archive', 'all');

    expect(store.switchTopic).not.toHaveBeenCalled();
  });

  it('archives only this one, reporting which direct sub-topics went back to another agent', async () => {
    const { action } = createAction(null);

    const result = await action.retireTopicTree('tpc_parent', 'archive', 'self');

    expect(mocks.archiveTopicTree).toHaveBeenCalledWith('tpc_parent', 'detach');
    expect(result.retired).toEqual(['tpc_parent']);
    expect(result.detached).toEqual([
      expect.objectContaining({ id: 'tpc_child', movedToOwnAgent: false }),
      expect.objectContaining({
        agentId: 'agt_codex',
        agentTitle: 'Agent of tpc_cross',
        id: 'tpc_cross',
        movedToOwnAgent: true,
      }),
    ]);
  });

  it('passes the attachment choice to the tree deletion', async () => {
    const { action } = createAction(null);

    await action.retireTopicTree('tpc_parent', 'trash', 'self', { removeFiles: false });

    expect(mocks.removeTopicTree).toHaveBeenCalledWith('tpc_parent', 'detach', false);
  });
});

describe('ChatSubTopicActionImpl.detachSubTopics', () => {
  it('moves each one up and says where the rows it knows went', async () => {
    const cross = row('tpc_cross', 'tpc_parent', { agentId: 'agt_codex' });
    const { action } = createAction(null, { key: [cross] });

    const result = await action.detachSubTopics(['tpc_cross']);

    expect(mocks.detachFromParent).toHaveBeenCalledWith('tpc_cross');
    expect(result.detached).toEqual([
      expect.objectContaining({ agentId: 'agt_codex', id: 'tpc_cross', movedToOwnAgent: true }),
    ]);
  });
});

describe('retirableSubTopics', () => {
  it('takes every descendant except task runs and what they opened', () => {
    const rows = [
      row('tpc_grand', 'tpc_child'),
      row('tpc_child', 'tpc_parent'),
      row('tpc_run', 'tpc_parent', { trigger: 'task' }),
      row('tpc_under_run', 'tpc_run'),
    ];

    expect(
      retirableSubTopics('tpc_parent', rows)
        .map((item) => item.id)
        .sort(),
    ).toEqual(['tpc_child', 'tpc_grand']);
  });
});
