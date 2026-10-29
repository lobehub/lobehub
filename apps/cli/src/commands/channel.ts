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

/** Operation-scoped reads: never fall back to the device owner's account or another channel. */
export const registerChannelCommand = (program: Command) => {
  const channel = program
    .command('channel')
    .description('Read the current Agent run’s Channel conversation');
  channel
    .command('history')
    .description('Read recent public messages; page backwards with the returned cursor')
    .option('--before <sequence>', 'Exclusive nextBeforeSequence cursor', numberOption)
    .option('--limit <count>', 'Messages per page (1–20, default 10)', numberOption)
    .option('--json', 'Print structured JSON')
    .action(async (options: { before?: number; limit?: number }) => {
      const client = await getTrpcClient();
      outputJson(
        projectChannelHistory(
          await client.channel.readMessages.query({
            beforeSequence: options.before,
            limit: options.limit,
          }),
        ),
      );
    });
  channel
    .command('message <id>')
    .description('Read a full public message and its attachment links')
    .option('--offset <characters>', 'Continue at nextOffset', numberOption)
    .option('--json', 'Print structured JSON')
    .action(async (messageId: string, options: { offset?: number }) => {
      const client = await getTrpcClient();
      outputJson(
        projectChannelHistory(
          await client.channel.readMessage.query({ messageId, offset: options.offset }),
        ),
      );
    });
};
