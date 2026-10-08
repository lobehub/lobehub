import { describe, expect, it, vi } from 'vitest';

import { resolveAgentSenderFromOperation } from './sourceAttribution';

const CALLER = 'user-1';

const buildDeps = (overrides?: {
  agentConfig?: unknown;
  operation?: null | undefined | { topicId?: null | string; userId: string };
  topic?: null | undefined | { agentId?: null | string; title?: null | string };
}) => ({
  findAgentConfig: vi.fn().mockResolvedValue(overrides?.agentConfig ?? undefined),
  findOperation: vi
    .fn()
    .mockResolvedValue(overrides?.operation === undefined ? null : overrides.operation),
  findTopic: vi.fn().mockResolvedValue(overrides?.topic === undefined ? null : overrides.topic),
  userId: CALLER,
});

describe('resolveAgentSenderFromOperation', () => {
  it('stamps nothing without an operation id, and never reads the models', async () => {
    const deps = buildDeps();

    await expect(resolveAgentSenderFromOperation(undefined, deps)).resolves.toBeUndefined();
    expect(deps.findOperation).not.toHaveBeenCalled();
    expect(deps.findTopic).not.toHaveBeenCalled();
  });

  it('stamps nothing for an operation it cannot resolve', async () => {
    const deps = buildDeps({ operation: null });

    await expect(resolveAgentSenderFromOperation('op-unknown', deps)).resolves.toBeUndefined();
    expect(deps.findTopic).not.toHaveBeenCalled();
  });

  /**
   * The trust rule. `AgentOperationModel.findById` is workspace-scoped, so in a
   * workspace it also resolves a sibling member's operation — the row's own
   * `userId` is what keeps a member from rendering arbitrary text as another
   * member's agent.
   */
  it("stamps nothing for a sibling member's operation in the same workspace", async () => {
    const deps = buildDeps({
      operation: { topicId: 'tpc-victim', userId: 'user-2' },
      topic: { agentId: 'agt-victim', title: 'Victim topic' },
    });

    await expect(resolveAgentSenderFromOperation('op-sibling', deps)).resolves.toBeUndefined();
    expect(deps.findTopic).not.toHaveBeenCalled();
    expect(deps.findAgentConfig).not.toHaveBeenCalled();
  });

  it('stamps nothing when the operation has no topic', async () => {
    const deps = buildDeps({ operation: { topicId: null, userId: CALLER } });

    await expect(resolveAgentSenderFromOperation('op-no-topic', deps)).resolves.toBeUndefined();
    expect(deps.findTopic).not.toHaveBeenCalled();
  });

  it('stamps nothing when the topic is gone or has no owning agent', async () => {
    const missing = buildDeps({ operation: { topicId: 'tpc-1', userId: CALLER }, topic: null });
    await expect(resolveAgentSenderFromOperation('op-1', missing)).resolves.toBeUndefined();

    const orphans = buildDeps({
      operation: { topicId: 'tpc-1', userId: CALLER },
      topic: { agentId: null, title: 'Orphan topic' },
    });
    await expect(resolveAgentSenderFromOperation('op-1', orphans)).resolves.toBeUndefined();
  });

  it("reads the topic and agent from the caller's own operation row", async () => {
    const deps = buildDeps({
      agentConfig: { avatar: '🐶', name: 'Coco', title: 'Product Assistant' },
      operation: { topicId: 'tpc-source', userId: CALLER },
      topic: { agentId: 'agt-coco', title: '帮我评估本周发布的风险' },
    });

    await expect(resolveAgentSenderFromOperation('op-1', deps)).resolves.toEqual({
      agentId: 'agt-coco',
      avatar: '🐶',
      name: 'Coco',
      title: 'Product Assistant',
      topicId: 'tpc-source',
      topicTitle: '帮我评估本周发布的风险',
    });
    expect(deps.findTopic).toHaveBeenCalledWith('tpc-source');
  });

  it('degrades to the bare ids when the sender config cannot be read', async () => {
    const deps = buildDeps({
      operation: { topicId: 'tpc-source', userId: CALLER },
      topic: { agentId: 'agt-coco', title: 'Source' },
    });
    deps.findAgentConfig.mockRejectedValue(new Error('agent deleted'));

    await expect(resolveAgentSenderFromOperation('op-1', deps)).resolves.toEqual({
      agentId: 'agt-coco',
      topicId: 'tpc-source',
      topicTitle: 'Source',
    });
  });
});
