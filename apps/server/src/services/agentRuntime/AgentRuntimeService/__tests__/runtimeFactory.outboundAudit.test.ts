// @vitest-environment node
import { AGENT_ACCOUNT_OUTBOUND_AUDIT } from '@lobechat/builtin-tool-agent-account';
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeFactoryDeps } from '../runtimeFactory';
import { createAgentRuntime } from '../runtimeFactory';

const inbox = vi.hoisted(() => ({ isInboxTopic: vi.fn() }));
vi.mock('@/database/models/agentInbox', () => ({ AgentInboxModel: inbox }));

/** The account outbound audit of a runtime built for a run with this origin. */
const outboundAuditFor = async (origin: { topicId?: string; trigger: RequestTrigger }) => {
  const agentFactory = vi.fn((config: any) => ({ config, runner: vi.fn() }));
  const deps = {
    agentFactory,
    completeGroupMemberBarrier: vi.fn(),
    coordinator: { isInterrupted: vi.fn(), loadAgentState: vi.fn() },
    delegate: {},
    serverDB: {},
    userId: 'user_1',
  } as unknown as RuntimeFactoryDeps;

  await createAgentRuntime(deps, {
    agentState: { origin: { ...origin, userId: 'user_1' } },
    operationId: 'op_1',
    stepIndex: 0,
  });

  return agentFactory.mock.calls[0][0].dynamicInterventionAudits[AGENT_ACCOUNT_OUTBOUND_AUDIT];
};

const threadReply = { text: 'my owner said…', threadKey: 'thread_1', to: 'sender@example.com' };

describe('createAgentRuntime — agent account outbound audit', () => {
  beforeEach(() => {
    inbox.isInboxTopic.mockReset().mockResolvedValue(false);
  });

  it('holds a thread reply for approval in a run an inbound message started', async () => {
    const audit = await outboundAuditFor({ trigger: RequestTrigger.Inbox });

    await expect(audit(threadReply)).resolves.toBe(true);
  });

  it('holds a thread reply in any later turn of a topic that holds outside mail', async () => {
    // e.g. the continuation a background sub-agent starts, stamped `chat`.
    inbox.isInboxTopic.mockResolvedValue(true);
    const audit = await outboundAuditFor({ topicId: 'tpc_inbox', trigger: RequestTrigger.Chat });

    await expect(audit(threadReply)).resolves.toBe(true);
    expect(inbox.isInboxTopic).toHaveBeenCalledWith({}, 'tpc_inbox');
  });

  it('holds the send when the topic cannot be checked', async () => {
    inbox.isInboxTopic.mockRejectedValue(new Error('db down'));
    const audit = await outboundAuditFor({ topicId: 'tpc_any', trigger: RequestTrigger.Chat });

    await expect(audit(threadReply)).resolves.toBe(true);
  });

  it('keeps the thread-reply exemption in a topic the owner started with no outside mail', async () => {
    const audit = await outboundAuditFor({ topicId: 'tpc_chat', trigger: RequestTrigger.Chat });

    await expect(audit(threadReply)).resolves.toBe(false);
  });

  it('looks nothing up until the agent actually sends', async () => {
    await outboundAuditFor({ topicId: 'tpc_chat', trigger: RequestTrigger.Chat });

    expect(inbox.isInboxTopic).not.toHaveBeenCalled();
  });
});
