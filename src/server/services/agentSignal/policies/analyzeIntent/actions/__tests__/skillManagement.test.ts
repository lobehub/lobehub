// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeProcessorContext } from '../../../../runtime/context';
import { defineSkillManagementActionHandler } from '../skillManagement';

const dispatch = vi.fn();

const createContext = (applied = false) =>
  ({
    now: () => 1,
    runtimeState: {
      getGuardState: vi.fn().mockResolvedValue(applied ? { lastEventAt: 1 } : {}),
      touchGuardState: vi.fn().mockResolvedValue({}),
    },
    scopeKey: 'topic:topic_1',
  }) as unknown as RuntimeProcessorContext;

const skillAction = {
  actionId: 'act_skill',
  actionType: 'action.skill-management.handle' as const,
  chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
  payload: {
    agentId: 'agent_1',
    evidence: [{ cue: 'reusable procedure', excerpt: 'Always run the weekly report this way.' }],
    feedbackHint: 'not_satisfied' as const,
    idempotencyKey: 'source_1:skill:msg_1',
    message: 'From now on, run the weekly report with these fixed steps...',
    messageId: 'msg_1',
    reason: 'reusable procedure feedback',
    serializedContext: '{"surface":"chat"}',
    topicId: 'topic_1',
  },
  signal: { signalId: 'sig_1', signalType: 'signal.feedback.domain.skill' as const },
  source: { sourceId: 'source_1', sourceType: 'agent.user.message' as const },
  timestamp: 1,
};

describe('defineSkillManagementActionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues an async skill run under the skill-management slug', async () => {
    dispatch.mockResolvedValue({ operationId: 'op_1', topicId: 'topic_1' });
    const context = createContext();

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      dispatch,
      selfIterationEnabled: true,
      userId: 'user_1',
    });

    const result = await handler.handle(skillAction, context);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const dispatched = dispatch.mock.calls[0][0];
    expect(dispatched.slug).toBe('skill-management');
    expect(dispatched.agentId).toBe('agent_1');
    expect(dispatched.topicId).toBe('topic_1');
    expect(dispatched.marker).toMatchObject({
      agentId: 'agent_1',
      kind: 'skill',
      sourceId: 'source_1:skill:msg_1',
      topicId: 'topic_1',
    });
    expect(typeof dispatched.prompt).toBe('string');
    expect(dispatched.prompt).toContain(skillAction.payload.message);
    expect(result?.status).toBe('applied');
    expect(context.runtimeState.touchGuardState).toHaveBeenCalledTimes(1);
  });

  it('skips when self-iteration is disabled (no dispatch)', async () => {
    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      dispatch,
      selfIterationEnabled: false,
      userId: 'user_1',
    });

    const result = await handler.handle(skillAction, createContext());

    expect(result?.status).toBe('skipped');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('skips when the feedback message is missing', async () => {
    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      dispatch,
      selfIterationEnabled: true,
      userId: 'user_1',
    });

    const result = await handler.handle(
      { ...skillAction, payload: { ...skillAction.payload, message: '   ' } },
      createContext(),
    );

    expect(result?.status).toBe('skipped');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('skips repeated actions after the same idempotency key was already applied', async () => {
    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      dispatch,
      selfIterationEnabled: true,
      userId: 'user_1',
    });

    const result = await handler.handle(skillAction, createContext(true));

    expect(result?.status).toBe('skipped');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('surfaces dispatch failures without marking idempotency', async () => {
    dispatch.mockRejectedValue(new Error('enqueue failed'));
    const context = createContext();

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      dispatch,
      selfIterationEnabled: true,
      userId: 'user_1',
    });

    const result = await handler.handle(skillAction, context);

    expect(result?.status).toBe('failed');
    expect(context.runtimeState.touchGuardState).not.toHaveBeenCalled();
  });
});
