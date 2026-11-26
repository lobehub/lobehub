import { randomUUID } from 'node:crypto';

import { projectChannelHistory } from '@lobechat/prompts/channel';
import type { Command } from 'commander';

import { getTrpcClient } from '../api/client';
import { outputJson } from '../utils/format';

const numberOption = (value: string) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error('Expected a non-negative integer');
  return result;
};

/**
 * Operation-scoped: reads stay in the run's Channel (its own conversation, or another Thread of
 * it by `--thread`), and an Agent it asks is asked as the run's Agent. Never falls back to the device
 * owner's account.
 */
export const registerChannelCommand = (program: Command) => {
  const channel = program
    .command('channel')
    .description(
      'Read the current Agent run’s Channel conversation, and ask Agents in other Channels',
    );
  channel
    .command('history')
    .description('Read recent public messages; page backwards with the returned cursor')
    .option('--before <sequence>', 'Exclusive nextBeforeSequence cursor', numberOption)
    .option('--limit <count>', 'Messages per page (1–20, default 10)', numberOption)
    .option(
      '--thread <threadId>',
      'Read another Thread of this Channel (from `channel threads`) live, instead of your own conversation',
    )
    .option('--json', 'Print structured JSON')
    .action(async (options: { before?: number; limit?: number; thread?: string }) => {
      const client = await getTrpcClient();
      outputJson(
        projectChannelHistory(
          await client.channel.readMessages.query({
            beforeSequence: options.before,
            limit: options.limit,
            threadId: options.thread,
          }),
        ),
      );
    });
  channel
    .command('message <id>')
    .description('Read a full public message and its attachment links')
    .option('--offset <characters>', 'Continue at nextOffset', numberOption)
    .option('--thread <threadId>', 'The Thread `history --thread` returned the message from')
    .option('--json', 'Print structured JSON')
    .action(async (messageId: string, options: { offset?: number; thread?: string }) => {
      const client = await getTrpcClient();
      outputJson(
        projectChannelHistory(
          await client.channel.readMessage.query({
            messageId,
            offset: options.offset,
            threadId: options.thread,
          }),
        ),
      );
    });
  channel
    .command('react <messageId> <emoji>')
    .description(
      'React to a message in this conversation with an emoji, as the running Agent; it posts nothing and notifies nobody',
    )
    .option('--remove', 'Remove your reaction instead')
    .option('--thread <threadId>', 'The Thread `history --thread` returned the message from')
    .option('--json', 'Print structured JSON')
    .action(
      async (messageId: string, emoji: string, options: { remove?: boolean; thread?: string }) => {
        const client = await getTrpcClient();
        outputJson(
          await client.channel.react.mutate({
            emoji,
            messageId,
            remove: options.remove,
            threadId: options.thread,
          }),
        );
      },
    );
  channel
    .command('threads')
    .description('List the Threads of this Channel, newest first, to read one with --thread')
    .option('--active', 'Only Threads where you have a queued or running reply')
    .option('--before <threadId>', 'Exclusive cursor: nextBefore of the previous page')
    .option('--limit <count>', 'Threads per page (1–20, default 10)', numberOption)
    .option('--json', 'Print structured JSON')
    .action(async (options: { active?: boolean; before?: string; limit?: number }) => {
      const client = await getTrpcClient();
      outputJson(
        await client.channel.listThreads.query({
          activeOnly: options.active,
          before: options.before,
          limit: options.limit,
        }),
      );
    });
  channel
    .command('list')
    .description(
      'List the Channels your requester belongs to and the Agents in each, to find where to reach an Agent',
    )
    .option('--agent <agentId>', 'Only Channels this Agent is a member of')
    .option('--query <text>', 'Match the Channel title or an Agent name')
    .option('--limit <count>', 'Channels to return (1–20, default 10)', numberOption)
    .option('--json', 'Print structured JSON')
    .action(async (options: { agent?: string; limit?: number; query?: string }) => {
      const client = await getTrpcClient();
      outputJson(
        await client.channel.listChannels.query({
          agentId: options.agent,
          limit: options.limit,
          query: options.query,
        }),
      );
    });
  channel
    .command('send <channelId>')
    .description(
      'Ask one Agent, in the conversation between you two; its answer wakes you there. channelId only hints where the person reaches it',
    )
    .requiredOption('--agent <agentId>', 'Agent to ask')
    .requiredOption('-c, --content <text>', 'The message, self-contained')
    .option('--request-key <key>', 'Reuse to retry without posting twice')
    .option('--json', 'Print structured JSON')
    .action(
      async (
        channelId: string,
        options: { agent: string; content: string; requestKey?: string },
      ) => {
        const client = await getTrpcClient();
        outputJson(
          await client.channel.sendMessage.mutate({
            agentIds: [options.agent],
            channelId,
            content: options.content,
            requestKey: options.requestKey ?? randomUUID(),
          }),
        );
      },
    );
};
