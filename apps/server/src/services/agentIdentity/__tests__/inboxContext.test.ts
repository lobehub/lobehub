// @vitest-environment node
import type { AgentState } from '@lobechat/agent-runtime';
import { AgentAccountIdentifier } from '@lobechat/builtin-tool-agent-account';
import { getTestDB } from '@lobechat/database/test-utils';
import { gatherContextFacts } from '@lobechat/mecha';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentAccounts, agentInboxMessages, agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type { RuntimeExecutorContext } from '@/server/modules/AgentRuntime/context';
import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';
import { createServerContextFactProviders } from '@/server/modules/Mecha/ContextEngineering/providers';
import { AgentAccountService } from '@/server/services/agentIdentity';
import { AgentInboxService } from '@/server/services/agentIdentity/inbox';
import { AgentAccountProviderRegistry } from '@/server/services/agentIdentity/registry';

/**
 * Evidence that the agent's **addresses and inbox are first-class runtime
 * state**.
 *
 * The chain is real end to end: real `agent_accounts` / `agent_inbox_messages`
 * rows on PGlite → the real server fact provider → the shared gather rules →
 * the shared context engine. Only the model call is absent — we inspect the
 * messages the engine would send.
 */

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-inbox-context-user';
const agentId = 'agent-inbox-context';

const factsRequest = (overrides: Record<string, unknown> = {}) => ({
  agent: { chatConfig: {}, description: null, slug: null, title: 'Toby' },
  agentId,
  enabledToolIds: [] as string[],
  executionTarget: 'sandbox' as const,
  features: { composio: false, lobehubSkill: false },
  messages: [{ content: 'hi', id: 'm1', role: 'user' }] as any[],
  ...overrides,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });
});

afterEach(async () => {
  await serverDB.delete(agentInboxMessages);
  await serverDB.delete(agentAccounts);
  await serverDB.delete(users);
});

const providers = () =>
  createServerContextFactProviders({
    ctx: { serverDB, userId } as unknown as RuntimeExecutorContext,
    state: { origin: { agentId } } as unknown as AgentState,
  });

describe('Agent identity as first-class runtime state', () => {
  it('injects the agent addresses and inbox into the messages the model receives', async () => {
    const account = await new AgentAccountService(serverDB, userId, {
      registry: new AgentAccountProviderRegistry(),
    }).create({
      agentId,
      capabilities: { receive: true, send: true },
      identifier: 'toby-agent@lobe.id',
      kind: 'mail',
      provider: 'user',
    });

    const inbox = new AgentInboxService(serverDB, userId);
    await inbox.record({
      accountId: account.id,
      agentId,
      from: 'login@service.com',
      kind: 'mail',
      provider: 'user',
      providerMessageId: 'msg_once',
      receivedAt: new Date('2026-10-02T12:00:00.000Z'),
      subject: 'Your verification code',
      text: 'Your verification code is 839201. It expires in 10 minutes.',
      to: 'toby-agent@lobe.id',
    });

    // 1. The fact is gathered from the real DB through the real provider.
    // Note `enabledToolIds: []` — the account tool is NOT enabled on this run.
    // The identity/inbox still reaches the model, which is the whole point: it
    // is state, not a tool result.
    expect(factsRequest().enabledToolIds).not.toContain(AgentAccountIdentifier);
    const facts = await gatherContextFacts(factsRequest(), providers());
    expect(facts.step.agentAccountContext).toBeDefined();
    expect(facts.step.agentAccountContext?.accounts).toHaveLength(1);
    expect(facts.step.agentAccountContext?.inbox.unreadCount).toBe(1);

    // 2. The shared context engine renders it into the system message.
    const { messages } = await serverMessagesEngine({
      agentAccountContext: facts.step.agentAccountContext,
      messages: [{ content: 'hi', id: 'm1', role: 'user' } as any],
      model: 'deepseek-chat',
      provider: 'deepseek',
      systemRole: 'You are toby.',
    });

    const system = String(messages.find((m) => m.role === 'system')?.content ?? '');
    // Surface the exact block for the delivery report.
    console.log(`\n[identity-context-block]\n${system}\n[/identity-context-block]\n`);
    expect(system).toContain('<agent_identity>');
    expect(system).toContain('mail toby-agent@lobe.id — user, can receive/send');
    expect(system).toContain('<inbox unread="1">');
    expect(system).toContain('from login@service.com');
    expect(system).toContain('codes 839201');
  });

  it('adds no identity block for an agent that owns nothing', async () => {
    const facts = await gatherContextFacts(factsRequest(), providers());
    expect(facts.step.agentAccountContext).toBeUndefined();

    const { messages } = await serverMessagesEngine({
      agentAccountContext: facts.step.agentAccountContext,
      messages: [{ content: 'hi', id: 'm1', role: 'user' } as any],
      model: 'deepseek-chat',
      provider: 'deepseek',
      systemRole: 'You are toby.',
    });

    expect(String(messages.find((m) => m.role === 'system')?.content ?? '')).not.toContain(
      '<agent_identity>',
    );
  });
});
