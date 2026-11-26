import { AgentAccountIdentifier } from '@lobechat/builtin-tool-agent-account';
import type { LobeChatDatabase } from '@lobechat/database';
import { BOT_NO_REPLY_TOKEN } from '@lobechat/types';
import debug from 'debug';

import { AgentAccountModel } from '@/database/models/agentAccount';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { ChannelRepository } from '@/database/repositories/channel';
import { extractTextFromMessage } from '@/server/services/agentRuntime/CompletionLifecycle/messageContent';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import { ChannelService } from '@/server/services/channel/ChannelService';
import { notifyChannel } from '@/server/services/channel/notify';
import { detectNoReply } from '@/server/services/conversationWake/noReply';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

const log = debug('lobe-server:agent-identity:owner-channel');

export const INBOX_REPORT_WEBHOOK = '/api/agent/webhooks/inbox-report';

/**
 * Where the result goes, told to the woken agent. A run nobody watches would otherwise end in a
 * topic its owner never opens.
 */
export const OWNER_CHANNEL_INSTRUCTION = `Your final answer is posted to your owner in your direct Channel with them, so write it to them. If nothing here needs them, answer exactly ${BOT_NO_REPLY_TOKEN} and nothing will be posted. In this run you can only read your mailbox, and a send is refused. If a reply is warranted, put the draft in your answer for your owner to approve.`;

/**
 * A woken run has nobody watching it, so it must end rather than park on an approval: a parked
 * segment would settle this report's hook with no answer, and its continuation would not carry it.
 * A call that needs the owner comes back to the agent as refused.
 */
export const INBOX_RUN_INTERVENTION = { approvalMode: 'headless' } as const;

/**
 * The only tools a mail-woken run gets: its own mailbox. Whoever wrote the mail is steering this
 * run, and headless auto-runs every call that merely `required` approval, so any other tool would
 * be theirs to use: a web fetch carries the owner's data out, a connector acts as the owner.
 * Exclusive also keeps out default tools and anything the activator could load mid-run.
 */
export const INBOX_RUN_PLUGIN_IDS = [AgentAccountIdentifier];

export type OwnerChannelReportResult =
  | 'no-account'
  | 'no-channel'
  | 'not-done'
  | 'posted'
  /** The agent chose silence (`NO_REPLY`), or ended without a text answer. */
  | 'silent';

/**
 * Posts what an inbox-woken run concluded to the account owner's direct Channel with the agent.
 *
 * The run stays in its own topic; only its final answer — the agent's words, never the mail it
 * read — reaches the Channel, as the agent's message. Opens the direct Channel when there is none
 * yet; one the owner moved to the trash stays there and nothing is posted.
 *
 * Idempotent per run: a repeated completion callback finds the post already there.
 */
export const reportRunToOwnerChannel = async (
  db: LobeChatDatabase,
  params: { accountId: string; operationId: string },
): Promise<OwnerChannelReportResult> => {
  const account = await AgentAccountModel.findByIdUnscoped(db, params.accountId);
  if (!account) return 'no-account';

  const workspaceId = account.workspaceId ?? undefined;
  const operation = await new AgentOperationModel(db, account.userId, workspaceId).findById(
    params.operationId,
  );
  if (operation?.status !== 'done' || !operation.topicId) return 'not-done';

  const final = await new MessageModel(
    db,
    account.userId,
    workspaceId,
  ).findLatestAssistantByOperationId({
    operationId: params.operationId,
    topicId: operation.topicId,
  });
  // A run that stopped on a tool call (out of steps) has nothing to tell yet.
  const content = final?.tools?.length ? undefined : extractTextFromMessage(final);
  if (!content?.trim() || detectNoReply({ content, wakeKind: 'followup' })) return 'silent';

  const access = await new ChannelService(db, account.userId, workspaceId).openDirect(
    account.agentId,
  );
  if (!access) return 'no-channel';

  const channelId = access.channel.id;
  await new ChannelRepository(db, account.userId, workspaceId).postAgentMessage(channelId, {
    agentId: account.agentId,
    content,
    metadata: {
      accountId: account.id,
      operationId: params.operationId,
      source: 'agent-inbox',
      topicId: operation.topicId,
    },
    requestKey: `agent-inbox:${params.operationId}`,
  });
  await notifyChannel(db, channelId);
  log('posted the run %s of account %s to channel %s', params.operationId, account.id, channelId);

  return 'posted';
};

/**
 * The completion hook an inbox-woken run carries: on the queue runtime a QStash webhook (the
 * process that started the run may be gone), otherwise an in-process handler.
 */
export const createOwnerChannelReportHook = (
  db: LobeChatDatabase,
  accountId: string,
): AgentHook => ({
  id: `agent-inbox-report:${accountId}`,
  type: 'onComplete',
  ...(isQueueAgentRuntimeEnabled()
    ? {
        webhook: {
          body: { accountId },
          delivery: 'qstash' as const,
          // Identity only: the answer is read back from storage, never carried in the envelope.
          eventFields: ['operationId'],
          fallback: 'none' as const,
          url: INBOX_REPORT_WEBHOOK,
        },
      }
    : {
        handler: async (event) => {
          await reportRunToOwnerChannel(db, { accountId, operationId: event.operationId }).catch(
            (error) => console.error('[agentInbox] reporting the run failed:', error),
          );
        },
      }),
});
