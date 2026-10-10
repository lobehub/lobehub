import type { AgentState } from '@lobechat/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { buildServerAgentMemberRunner, resolveGroupMemberId } from '../executorHelpers';

describe('resolveGroupMemberId', () => {
  const agentMap = {
    agt_member: { name: 'Meituan Assistant' },
    agt_supervisor: { name: 'Supervisor' },
  };

  it('keeps a persisted agent id unchanged', () => {
    expect(resolveGroupMemberId('agt_member', agentMap)).toBe('agt_member');
  });

  it('resolves an exact member display name to its persisted agent id', () => {
    expect(resolveGroupMemberId('Meituan Assistant', agentMap)).toBe('agt_member');
  });

  it('does not guess when a display name is ambiguous', () => {
    expect(
      resolveGroupMemberId('Assistant', {
        agt_first: { name: 'Assistant' },
        agt_second: { name: 'Assistant' },
      }),
    ).toBe('Assistant');
  });
});

// G-05: the member runner hands the supervisor run's approval policy to every
// forked member instead of letting them fall back to headless.
describe('buildServerAgentMemberRunner', () => {
  it.each(['allow', 'blocked'] as const)(
    'publishes a failed member start only after its hook returns %s while its sibling starts',
    async (status) => {
      const rows: Record<string, any>[] = [];
      const onGroupMemberResult = vi.fn(async () => {
        expect(rows[1].content).not.toBe('');
        return true;
      });
      let decide!: (value: { status: 'allow' | 'blocked' }) => void;
      const decision = new Promise<{ status: 'allow' | 'blocked' }>((resolve) => {
        decide = resolve;
      });
      let entered!: () => void;
      const hookEntered = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const evaluateAfterToolCall = vi.fn(async () => {
        entered();
        return decision;
      });
      const messageModel = {
        create: vi.fn(async (value) => {
          const row = { ...value, id: `row-${rows.length}` };
          rows.push(row);
          return row;
        }),
        findById: vi.fn(async (id) => rows.find((row) => row.id === id)),
        findMessagePlugin: vi.fn(async (id) => {
          const row = rows.find((row) => row.id === id);
          return row && { ...row.plugin, toolCallId: row.tool_call_id, state: row.pluginState };
        }),
        updateToolMessage: vi.fn(async (id, value) => {
          Object.assign(
            rows.find((row) => row.id === id)!,
            value,
          );
          return { success: true };
        }),
      };
      const runner = buildServerAgentMemberRunner(
        {
          execGroupMember: vi.fn(async ({ agentId }) => ({ started: agentId === 'sibling' })),
          hookDispatcher: { hasAfterToolCallControl: () => true, evaluateAfterToolCall },
          messageModel,
          onGroupMemberResult,
          operationId: 'op-sup',
          topicId: 'topic',
          userId: 'owner',
        } as unknown as RuntimeExecutorContext,
        {
          origin: { agentId: 'supervisor', groupId: 'group', topicId: 'topic' },
        } as AgentState,
        {
          apiName: 'executeAgentTasks',
          identifier: 'lobe-group-management',
          arguments: '{}',
          id: 'call',
          type: 'builtin',
        },
        'assistant',
      )!;
      const run = runner.run({
        members: [
          { agentId: 'failed', instruction: 'go' },
          { agentId: 'sibling', instruction: 'go' },
        ],
        mode: 'in_group',
        onComplete: 'resume',
      });
      await Promise.race([hookEntered, run]);
      expect(evaluateAfterToolCall).toHaveBeenCalledTimes(1);
      expect(rows.map((row) => row.content)).toEqual(['', '', '']);
      expect(rows.every((row) => !row.metadata?.toolResultControl)).toBe(true);
      expect(messageModel.updateToolMessage).not.toHaveBeenCalled();
      expect(onGroupMemberResult).not.toHaveBeenCalled();
      decide({ status });
      await expect(run).resolves.toMatchObject({ started: true, startedCount: 1 });
      expect(rows[1].content).toBe(
        status === 'allow'
          ? 'Agent member "failed" failed to start.'
          : 'Tool result withheld by afterToolCall hook.',
      );
      expect(rows[0].metadata).toEqual({ agentCouncil: true });
      expect(rows[2].content).toBe('');
      expect(onGroupMemberResult).toHaveBeenCalledTimes(1);
    },
  );

  it('forwards the supervisor approval policy to each member', async () => {
    const execGroupMember = vi.fn().mockResolvedValue({ operationId: 'op-m', started: true });
    const ctx = {
      execGroupMember,
      messageModel: {
        create: vi.fn().mockResolvedValue({ id: 'group-tool-1' }),
        updateToolMessage: vi.fn(),
      },
      operationId: 'op-sup',
      topicId: 'topic-1',
    } as unknown as RuntimeExecutorContext;
    const state = {
      origin: { agentId: 'agt_sup', groupId: 'group-1', topicId: 'topic-1' },
      principal: { policy: { userIntervention: { approvalMode: 'manual' } } },
    } as unknown as AgentState;

    const runner = buildServerAgentMemberRunner(
      ctx,
      state,
      { apiName: 'speak', arguments: '{}', id: 'call_1', identifier: 'x', type: 'builtin' },
      'sup-msg-1',
    );
    await runner!.run({
      members: [{ agentId: 'agt_carol', instruction: 'go' }],
      mode: 'in_group',
      onComplete: 'resume',
    });

    expect(execGroupMember).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_carol',
        parentOperationId: 'op-sup',
        userInterventionConfig: { approvalMode: 'manual' },
      }),
    );
  });

  // An approved group tool resumes on its own pending row (`call_tool` with
  // `skipCreateToolMessage`). Writing a second row with the same tool_call_id
  // under it rendered as an orphan skill call with a delete button.
  it('reuses the approved pending tool row instead of writing a duplicate', async () => {
    const execGroupMember = vi.fn().mockResolvedValue({ operationId: 'op-m', started: true });
    const messageModel = {
      create: vi.fn().mockResolvedValue({ id: 'new-row' }),
      findById: vi.fn().mockResolvedValue({ id: 'approved-tool', parentId: 'sup-msg-1' }),
      updateMetadata: vi.fn(),
      updatePluginState: vi.fn(),
      updateToolMessage: vi.fn(),
    };
    const ctx = {
      execGroupMember,
      messageModel,
      operationId: 'op-sup',
      topicId: 'topic-1',
    } as unknown as RuntimeExecutorContext;
    const state = {
      origin: { agentId: 'agt_sup', groupId: 'group-1', topicId: 'topic-1' },
    } as unknown as AgentState;

    const runner = buildServerAgentMemberRunner(
      ctx,
      state,
      {
        apiName: 'executeAgentTask',
        arguments: '{}',
        id: 'call_1',
        identifier: 'lobe-group-management',
        type: 'builtin',
      },
      'approved-tool',
      'approved-tool',
    );
    await runner!.run({
      members: [{ agentId: 'agt_carol', instruction: 'go' }],
      mode: 'isolated',
      onComplete: 'resume',
    });

    expect(messageModel.create).not.toHaveBeenCalled();
    expect(messageModel.updatePluginState).toHaveBeenCalledWith('approved-tool', {
      expectedMembers: 1,
      onComplete: 'resume',
      status: 'pending',
    });
    expect(execGroupMember).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorMessageId: 'approved-tool',
        groupToolMessageId: 'approved-tool',
        supervisorMessageId: 'sup-msg-1',
      }),
    );
  });
});
