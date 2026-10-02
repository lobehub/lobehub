import { RequestTrigger } from '@lobechat/types';

import type { AgentAccountView } from '@/database/models/agentAccount';
import type { AgentInboxMessageItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';

import type { AgentInboundWakeInput, AgentInboundWaker } from './inbound';

/**
 * The prompt the woken agent sees. It is deliberately terse: the message body
 * is already injected as first-class inbox state on the very first step (see
 * the inbox context injector), so this prompt only has to say *why* a turn is
 * starting, not repeat the message.
 */
const buildInboundPrompt = (account: AgentAccountView, message: AgentInboxMessageItem): string => {
  const subject = message.subject ? ` (subject: ${message.subject})` : '';
  return (
    `A new message arrived for your ${account.kind} account ${account.identifier} ` +
    `from ${message.from}${subject}. Read it and decide what to do.`
  );
};

/**
 * Production waker: starts a normal agent run on the account's owner, stamped
 * with {@link RequestTrigger.Inbox} so completion push and spend attribution
 * treat it as an external event rather than a user turn.
 *
 * The run is started on the owner's `userId` — the webhook has no caller
 * identity, and the message belongs to whoever owns the account.
 */
export const createAgentInboundWaker = (db: LobeChatDatabase): AgentInboundWaker => ({
  wake: async ({ account, message }: AgentInboundWakeInput) => {
    const service = new AiAgentService(db, account.userId, {
      workspaceId: account.workspaceId ?? undefined,
    });

    // Returns once the operation exists (`ExecAgentResult` is "started", not
    // "finished"), so the webhook answers the provider promptly while the run
    // continues in the background.
    const result = await service.execAgent({
      agentId: account.agentId,
      appContext: { scope: 'agent' } as never,
      prompt: buildInboundPrompt(account, message),
      trigger: RequestTrigger.Inbox,
    });

    if (result.error) {
      return { reason: `start-failed: ${result.error}`, started: false };
    }

    return { reason: 'started', started: true };
  },
});
