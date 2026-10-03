import { RequestTrigger } from '@lobechat/types';

import type { AgentAccountView } from '@/database/models/agentAccount';
import type { AgentInboxMessageItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';

import type { AgentInboundWakeInput, AgentInboundWaker } from './inbound';
import { fenceUntrustedInbox, toUntrustedInboxEntry } from './untrusted';

/** Body budget for the wake prompt; the full text stays readable through the tool. */
const WAKE_BODY_PREVIEW_CHARS = 2000;

/**
 * The prompt the woken agent sees. Only the first sentence is ours; the
 * message itself is attacker-controlled, so it rides on the user side inside
 * an `<untrusted_inbox>` fence and never reaches the system prompt.
 */
export const buildInboundPrompt = (account: AgentAccountView, message: AgentInboxMessageItem): string =>
  [
    `A new message arrived for your ${account.kind} account ${account.identifier}. Decide whether it needs anything from you.`,
    fenceUntrustedInbox([
      toUntrustedInboxEntry(message, { maxBodyChars: WAKE_BODY_PREVIEW_CHARS }),
    ]),
  ].join('\n\n');

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
