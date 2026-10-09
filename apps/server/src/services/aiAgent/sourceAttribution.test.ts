import type { AgentOperationStatus } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { resolveAgentSenderFromOperation } from './sourceAttribution';

const CALLER = 'user-1';

const buildDeps = (overrides?: {
  agentDisplay?: unknown;
  operation?:
    | null
    | undefined
    | {
        agentId?: null | string;
        status?: AgentOperationStatus;
        topicId?: null | string;
        userId: string;
      };
  topic?: null | undefined | { agentId?: null | string; title?: null | string };
}) => ({
  findAgentDisplayFields: vi.fn().mockResolvedValue(overrides?.agentDisplay ?? undefined),
  findOperation: vi.fn().mockResolvedValue(
    overrides?.operation === undefined || overrides.operation === null
      ? null
      : // Default to an in-flight run so each case states only what it exercises.
        { status: 'running', ...overrides.operation },
  ),
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
    expect(deps.findAgentDisplayFields).not.toHaveBeenCalled();
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

  /**
   * `LOBEHUB_OPERATION_ID` is an ambient env var: a shell, or a long-lived child
   * process, keeps it after its run finishes, and the public API can replay any
   * prior id. A settled run must therefore stop granting authorship.
   */
  it('carries the group and thread the launching turn actually ran in', async () => {
    const deps = buildDeps({
      operation: {
        agentId: 'agt-coco',
        chatGroupId: 'grp_1',
        threadId: 'thd_1',
        topicId: 'tpc-source',
        userId: CALLER,
      },
      topic: { agentId: 'agt-coco', title: 'Source' },
    });

    const result = await resolveAgentSenderFromOperation('op-1', deps);

    // The link is built from these: without them a group source opens the
    // supervisor's conversation and a thread source opens the main transcript.
    expect(result).toMatchObject({ chatGroupId: 'grp_1', threadId: 'thd_1' });
  });

  it('stamps nothing for an operation that has already settled', async () => {
    for (const status of ['abandoned', 'done', 'error', 'interrupted'] as const) {
      const deps = buildDeps({
        operation: { agentId: 'agt-coco', status, topicId: 'tpc-source', userId: CALLER },
        topic: { agentId: 'agt-coco', title: 'Source' },
      });

      await expect(resolveAgentSenderFromOperation('op-settled', deps)).resolves.toBeUndefined();
      expect(deps.findTopic).not.toHaveBeenCalled();
    }
  });

  it('still attributes an operation that is only waiting', async () => {
    for (const status of ['idle', 'waiting_for_human', 'waiting_for_async_tool'] as const) {
      const deps = buildDeps({
        operation: { agentId: 'agt-coco', status, topicId: 'tpc-source', userId: CALLER },
        topic: { agentId: 'agt-coco', title: 'Source' },
      });

      await expect(resolveAgentSenderFromOperation('op-1', deps)).resolves.toMatchObject({
        agentId: 'agt-coco',
      });
    }
  });

  it("reads the topic and agent from the caller's own operation row", async () => {
    const deps = buildDeps({
      agentDisplay: { avatar: '🐶', name: 'Coco', title: 'Product Assistant' },
      operation: { agentId: 'agt-coco', topicId: 'tpc-source', userId: CALLER },
      topic: { agentId: 'agt-coco', title: '帮我评估本周发布的风险' },
    });

    await expect(resolveAgentSenderFromOperation('op-1', deps)).resolves.toEqual({
      agentId: 'agt-coco',
      avatar: '🐶',
      name: 'Coco',
      title: 'Product Assistant',
      topicAgentId: 'agt-coco',
      topicId: 'tpc-source',
      topicTitle: '帮我评估本周发布的风险',
    });
    expect(deps.findTopic).toHaveBeenCalledWith('tpc-source');
  });

  /**
   * A heterogeneous `callSubAgent` child executes in an isolation thread on its
   * SPAWNER's topic, so the operation's agent and the topic's owner differ. The
   * child sent the turn; the parent owns the conversation the link points at.
   */
  it("attributes a sub-agent child, and links back to the topic's own agent", async () => {
    const deps = buildDeps({
      agentDisplay: { avatar: '🤖', name: 'Release Bot', title: 'Release Bot' },
      operation: { agentId: 'agt-child', topicId: 'tpc-parent', userId: CALLER },
      topic: { agentId: 'agt-parent', title: 'Parent thread' },
    });

    await expect(resolveAgentSenderFromOperation('op-1', deps)).resolves.toEqual({
      agentId: 'agt-child',
      avatar: '🤖',
      name: 'Release Bot',
      title: 'Release Bot',
      topicAgentId: 'agt-parent',
      topicId: 'tpc-parent',
      topicTitle: 'Parent thread',
    });
    expect(deps.findAgentDisplayFields).toHaveBeenCalledWith('agt-child');
  });

  it("falls back to the topic's owner when the operation names no agent", async () => {
    const deps = buildDeps({
      operation: { agentId: null, topicId: 'tpc-source', userId: CALLER },
      topic: { agentId: 'agt-coco', title: 'Source' },
    });

    await expect(resolveAgentSenderFromOperation('op-1', deps)).resolves.toEqual({
      agentId: 'agt-coco',
      topicAgentId: 'agt-coco',
      topicId: 'tpc-source',
      topicTitle: 'Source',
    });
  });

  it('degrades to the bare ids when the sender config cannot be read', async () => {
    const deps = buildDeps({
      operation: { agentId: 'agt-coco', topicId: 'tpc-source', userId: CALLER },
      topic: { agentId: 'agt-coco', title: 'Source' },
    });
    deps.findAgentDisplayFields.mockRejectedValue(new Error('agent deleted'));

    await expect(resolveAgentSenderFromOperation('op-1', deps)).resolves.toEqual({
      agentId: 'agt-coco',
      topicAgentId: 'agt-coco',
      topicId: 'tpc-source',
      topicTitle: 'Source',
    });
  });
});
