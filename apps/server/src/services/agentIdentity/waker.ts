import { RequestTrigger } from '@lobechat/types';

import type { AgentAccountView } from '@/database/models/agentAccount';
import { AgentInboxModel } from '@/database/models/agentInbox';
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

    // A reply in an ongoing thread continues the conversation the earlier
    // message started, instead of opening one topic per email.
    const threadTopicId = message.threadKey
      ? await AgentInboxModel.findThreadTopicId(db, {
          accountId: account.id,
          threadKey: message.threadKey,
        })
      : undefined;

    // Returns once the operation exists (`ExecAgentResult` is "started", not
    // "finished"), so the webhook answers the provider promptly while the run
    // continues in the background.
    const start = (topicId?: string) =>
      service.execAgent({
        agentId: account.agentId,
        appContext: { scope: 'agent', topicId },
        prompt: buildInboundPrompt(account, message),
        trigger: RequestTrigger.Inbox,
      });

    let result = await start(threadTopicId);
    // The thread's topic may have been deleted since; a fresh topic beats no wake.
    if (result.error && threadTopicId) result = await start();

    if (result.error) {
      console.error('[agentInbound] run did not start for account %s: %s', account.id, result.error);
      return { reason: 'start-failed', started: false };
    }

    await AgentInboxModel.markWoken(db, message.id, result.topicId);

    return { reason: 'started', started: true, topicId: result.topicId };
  },
});
