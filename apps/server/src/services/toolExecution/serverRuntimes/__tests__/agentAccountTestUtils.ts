import { AgentAccountIdentifier } from '@lobechat/builtin-tool-agent-account';
import type { AgentMailAttachment } from '@lobechat/types';
import { afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { agentAccounts, agentInboxMessages, agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AgentAccountService } from '@/server/services/agentIdentity';
import { AgentInboxService } from '@/server/services/agentIdentity/inbox';
import { AgentAccountProviderRegistry } from '@/server/services/agentIdentity/registry';
import type { ToolExecutionContext } from '@/server/services/toolExecution/types';

import { getServerRuntime } from '../index';

export const userId = 'agent-account-tool-user';
export const agentId = 'agent-account-tool-agent';
export const AGENT_ADDRESS = 'toby-agent@lobe.id';

/** The flat shape these tests describe one inbound delivery with. */
export interface InboundDelivery {
  accountId: string;
  agentId: string;
  attachments?: AgentMailAttachment[];
  from: string;
  kind?: string;
  provider?: string;
  providerMessageId: string;
  receivedAt: Date;
  subject?: string;
  text: string;
  threadKey?: string;
  to: string;
}

/**
 * Registers the per-test setup for the agent-account runtime against a real
 * database — one user, one agent and one receive-and-send mail account — and
 * returns the helpers the tests drive it with.
 */
export const useAgentAccountRuntime = (serverDB: LobeChatDatabase) => {
  const state = { accountId: '' };

  beforeAll(() => {
    // A real 32-byte AES-GCM key so the send path reaches the provider registry.
    vi.stubEnv('KEY_VAULTS_SECRET', Buffer.alloc(32, 5).toString('base64'));
  });

  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(agents).values({ id: agentId, userId });

    const account = await new AgentAccountService(serverDB, userId, {
      registry: new AgentAccountProviderRegistry(),
    }).create({
      agentId,
      capabilities: { receive: true, send: true },
      identifier: AGENT_ADDRESS,
      kind: 'mail',
      provider: 'user',
    });
    state.accountId = account.id;
  });

  afterEach(async () => {
    await serverDB.delete(agentInboxMessages);
    await serverDB.delete(agentAccounts);
    await serverDB.delete(users);
  });

  const context = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext =>
    ({ agentId, serverDB, userId, ...overrides }) as unknown as ToolExecutionContext;

  const runtime = (overrides: Partial<ToolExecutionContext> = {}) =>
    getServerRuntime(AgentAccountIdentifier, context(overrides));

  /** Record one inbound mail the way the inbound edge does (mail row, then inbox item). */
  const recordInbound = (params: InboundDelivery) =>
    new AgentInboxService(serverDB, userId).recordInboundMail({
      account: {
        agentId: params.agentId,
        id: params.accountId,
        identifier: params.to,
        provider: params.provider ?? 'user',
      },
      message: {
        from: params.from,
        mail: params.attachments
          ? {
              attachments: params.attachments,
              cc: [],
              references: [],
              replyTo: [],
              to: [{ address: params.to }],
            }
          : undefined,
        providerMessageId: params.providerMessageId,
        receivedAt: params.receivedAt,
        subject: params.subject,
        text: params.text,
        threadKey: params.threadKey,
        to: params.to,
      },
    });

  /** A verification-code mail to the fixture account, with per-test overrides. */
  const record = (
    overrides: Partial<{
      from: string;
      providerMessageId: string;
      receivedAt: Date;
      subject: string;
      text: string;
    }> = {},
  ) =>
    recordInbound({
      accountId: state.accountId,
      agentId,
      from: overrides.from ?? 'login@service.com',
      providerMessageId: overrides.providerMessageId ?? 'msg_1',
      receivedAt: overrides.receivedAt ?? new Date('2026-10-02T12:00:00.000Z'),
      subject: overrides.subject ?? 'Your verification code',
      text: overrides.text ?? 'Your verification code is 839201. It expires in 10 minutes.',
      to: AGENT_ADDRESS,
    });

  return { context, record, recordInbound, runtime, state };
};

/** The JSON entries inside an `<untrusted_inbox>` fence. */
export const fencedEntries = (content: string) => {
  const lines = content.slice(content.indexOf('<untrusted_inbox>')).split('\n');
  const close = lines.indexOf('</untrusted_inbox>');
  // Line 0 opens the fence, line 1 is the untrusted-data preamble.
  return JSON.parse(lines.slice(2, close).join('\n'));
};
