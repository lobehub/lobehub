import { DEFAULT_BOT_HISTORY_LIMIT } from '@lobechat/const';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerBotMessageCommands(bot: Command) {
  const message = bot
    .command('message')
    .description('Send and manage messages on connected platforms');

  // ── send ────────────────────────────────────────────────

  message
    .command('send <botId>')
    .description('Send a message to a channel')
    .requiredOption('--target <channelId>', 'Target channel / conversation ID')
    .requiredOption('--message <text>', 'Message content')
    .option('--reply-to <messageId>', 'Reply to a specific message')
    .option('--json', 'Output JSON')
    .action(
      async (
        botId: string,
        options: { json?: boolean; message: string; replyTo?: string; target: string },
      ) => {
        const client = await getTrpcClient();
        const result = await client.botMessage.sendMessage.mutate({
          botId,
          channelId: options.target,
          content: options.message,
          replyTo: options.replyTo,
        });

        if (options.json) {
          outputJson(result);
          return;
        }

        const r = result as any;
        console.log(
          `${pc.green('✓')} Message sent${r.messageId ? ` (${pc.dim(r.messageId)})` : ''}`,
        );
      },
    );

  // ── read ────────────────────────────────────────────────

  message
    .command('read <botId>')
    .description('Read messages from a channel')
    .requiredOption('--target <channelId>', 'Target channel / conversation ID')
    .option('--limit <n>', 'Max messages to fetch', String(DEFAULT_BOT_HISTORY_LIMIT))
    .option('--before <messageId>', 'Read messages before this ID')
    .option('--after <messageId>', 'Read messages after this ID')
    .option('--start-time <timestamp>', 'Start time as Unix seconds (Feishu/Lark)')
    .option('--end-time <timestamp>', 'End time as Unix seconds (Feishu/Lark)')
    .option('--cursor <token>', 'Pagination cursor from a previous response (Feishu/Lark)')
    .option('--json', 'Output JSON')
    .action(
      async (
        botId: string,
        options: {
          after?: string;
          before?: string;
          cursor?: string;
          endTime?: string;
          json?: boolean;
          limit?: string;
          startTime?: string;
          target: string;
        },
      ) => {
        const client = await getTrpcClient();
        const result = await client.botMessage.readMessages.query({
          after: options.after,
          before: options.before,
          botId,
          channelId: options.target,
          cursor: options.cursor,
          endTime: options.endTime,
          limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
          startTime: options.startTime,
        });

        if (options.json) {
          outputJson(result);
          return;
        }

        const messages = (result as any).messages ?? [];
        if (messages.length === 0) {
          console.log('No messages found.');
          return;
        }

        const rows = messages.map((m: any) => [
          m.id || '',
          m.author?.name || '',
          truncate(m.content || '', 60),
          m.timestamp || '',
        ]);

        printTable(rows, ['ID', 'AUTHOR', 'CONTENT', 'TIME']);

        const r = result as any;
        if (r.hasMore && r.nextCursor) {
          console.log(
            `\nMore messages available. Use ${pc.dim(`--cursor ${r.nextCursor}`)} to fetch next page.`,
          );
        }
      },
    );

  // ── edit ────────────────────────────────────────────────

  message
    .command('edit <botId>')
    .description('Edit a message')
    .requiredOption('--target <channelId>', 'Channel ID')
    .requiredOption('--message-id <id>', 'Message ID to edit')
    .requiredOption('--message <text>', 'New message content')
    .action(
      async (botId: string, options: { message: string; messageId: string; target: string }) => {
        const client = await getTrpcClient();
        await client.botMessage.editMessage.mutate({
          botId,
          channelId: options.target,
          content: options.message,
          messageId: options.messageId,
        });

        console.log(`${pc.green('✓')} Message ${pc.bold(options.messageId)} edited`);
      },
    );

  // ── delete ──────────────────────────────────────────────

  message
    .command('delete <botId>')
    .description('Delete a message')
    .requiredOption('--target <channelId>', 'Channel ID')
    .requiredOption('--message-id <id>', 'Message ID to delete')
    .option('--yes', 'Skip confirmation prompt')
    .action(
      async (botId: string, options: { messageId: string; target: string; yes?: boolean }) => {
        if (!options.yes) {
          const confirmed = await confirm('Are you sure you want to delete this message?');
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const client = await getTrpcClient();
        await client.botMessage.deleteMessage.mutate({
          botId,
          channelId: options.target,
          messageId: options.messageId,
        });

        console.log(`${pc.green('✓')} Message ${pc.bold(options.messageId)} deleted`);
      },
    );

  // ── search ──────────────────────────────────────────────

  message
    .command('search <botId>')
    .description('Search messages in a channel')
    .requiredOption('--target <channelId>', 'Channel ID to search in')
    .requiredOption('--query <text>', 'Search query')
    .option('--author-id <id>', 'Filter by author ID')
    .option('--limit <n>', 'Max results')
    .option('--json', 'Output JSON')
    .action(
      async (
        botId: string,
        options: {
          authorId?: string;
          json?: boolean;
          limit?: string;
          query: string;
          target: string;
        },
      ) => {
        const client = await getTrpcClient();
        const result = await client.botMessage.searchMessages.query({
          authorId: options.authorId,
          botId,
          channelId: options.target,
          limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
          query: options.query,
        });

        if (options.json) {
          outputJson(result);
          return;
        }

        const messages = (result as any).messages ?? [];
        if (messages.length === 0) {
          console.log('No messages found.');
          return;
        }

        const rows = messages.map((m: any) => [
          m.id || '',
          m.author?.name || '',
          truncate(m.content || '', 60),
        ]);

        printTable(rows, ['ID', 'AUTHOR', 'CONTENT']);
      },
    );

  // ── react ───────────────────────────────────────────────

  message
    .command('react <botId>')
    .description('Add an emoji reaction to a message')
    .requiredOption('--target <channelId>', 'Channel ID')
    .requiredOption('--message-id <id>', 'Message ID to react to')
    .requiredOption('--emoji <emoji>', 'Emoji to react with')
    .action(
      async (botId: string, options: { emoji: string; messageId: string; target: string }) => {
        const client = await getTrpcClient();
        await client.botMessage.reactToMessage.mutate({
          botId,
          channelId: options.target,
          emoji: options.emoji,
          messageId: options.messageId,
        });

        console.log(
          `${pc.green('✓')} Reacted with ${options.emoji} to message ${pc.bold(options.messageId)}`,
        );
      },
    );

  // ── reactions ───────────────────────────────────────────

  message
    .command('reactions <botId>')
    .description('List reactions on a message')
    .requiredOption('--target <channelId>', 'Channel ID')
    .requiredOption('--message-id <id>', 'Message ID')
    .option('--json', 'Output JSON')
    .action(
      async (botId: string, options: { json?: boolean; messageId: string; target: string }) => {
        const client = await getTrpcClient();
        const result = await client.botMessage.getReactions.query({
          botId,
          channelId: options.target,
          messageId: options.messageId,
        });

        if (options.json) {
          outputJson(result);
          return;
        }

        const reactions = (result as any).reactions ?? [];
        if (reactions.length === 0) {
          console.log('No reactions found.');
          return;
        }

        const rows = reactions.map((r: any) => [r.emoji || '', String(r.count || 0)]);
        printTable(rows, ['EMOJI', 'COUNT']);
      },
    );

  // ── pin ─────────────────────────────────────────────────

  message
    .command('pin <botId>')
    .description('Pin a message')
    .requiredOption('--target <channelId>', 'Channel ID')
    .requiredOption('--message-id <id>', 'Message ID to pin')
    .action(async (botId: string, options: { messageId: string; target: string }) => {
      const client = await getTrpcClient();
      await client.botMessage.pinMessage.mutate({
        botId,
        channelId: options.target,
        messageId: options.messageId,
      });

      console.log(`${pc.green('✓')} Pinned message ${pc.bold(options.messageId)}`);
    });

  // ── unpin ───────────────────────────────────────────────

  message
    .command('unpin <botId>')
    .description('Unpin a message')
    .requiredOption('--target <channelId>', 'Channel ID')
    .requiredOption('--message-id <id>', 'Message ID to unpin')
    .action(async (botId: string, options: { messageId: string; target: string }) => {
      const client = await getTrpcClient();
      await client.botMessage.unpinMessage.mutate({
        botId,
        channelId: options.target,
        messageId: options.messageId,
      });

      console.log(`${pc.green('✓')} Unpinned message ${pc.bold(options.messageId)}`);
    });

  // ── pins ────────────────────────────────────────────────

  message
    .command('pins <botId>')
    .description('List pinned messages')
    .requiredOption('--target <channelId>', 'Channel ID')
    .option('--json', 'Output JSON')
    .action(async (botId: string, options: { json?: boolean; target: string }) => {
      const client = await getTrpcClient();
      const result = await client.botMessage.listPins.query({
        botId,
        channelId: options.target,
      });

      if (options.json) {
        outputJson(result);
        return;
      }

      const messages = (result as any).messages ?? [];
      if (messages.length === 0) {
        console.log('No pinned messages.');
        return;
      }

      const rows = messages.map((m: any) => [
        m.id || '',
        m.author?.name || '',
        truncate(m.content || '', 60),
      ]);

      printTable(rows, ['ID', 'AUTHOR', 'CONTENT']);
    });

  // ── poll ────────────────────────────────────────────────

  message
    .command('poll <botId>')
    .description('Create a poll')
    .requiredOption('--target <channelId>', 'Channel ID')
    .requiredOption('--poll-question <text>', 'Poll question')
    .requiredOption('--poll-option <option>', 'Poll option (repeatable)', collectOptions, [])
    .option('--poll-multi', 'Allow multiple answers')
    .option('--poll-duration-hours <n>', 'Poll duration in hours')
    .action(
      async (
        botId: string,
        options: {
          pollDurationHours?: string;
          pollMulti?: boolean;
          pollOption: string[];
          pollQuestion: string;
          target: string;
        },
      ) => {
        if (options.pollOption.length < 2) {
          log.error('At least 2 poll options are required.');
          process.exit(1);
        }

        const client = await getTrpcClient();
        const result = await client.botMessage.createPoll.mutate({
          botId,
          channelId: options.target,
          duration: options.pollDurationHours
            ? Number.parseInt(options.pollDurationHours, 10)
            : undefined,
          multipleAnswers: options.pollMulti,
          options: options.pollOption,
          question: options.pollQuestion,
        });

        const r = result as any;
        console.log(`${pc.green('✓')} Poll created${r.pollId ? ` (${pc.dim(r.pollId)})` : ''}`);
      },
    );

  // ── thread (subcommand group) ───────────────────────────

  const thread = message.command('thread').description('Manage threads');

  thread
    .command('create <botId>')
    .description('Create a new thread')
    .requiredOption('--target <channelId>', 'Channel ID')
    .requiredOption('--thread-name <name>', 'Thread name')
    .option('--message <text>', 'Initial message content')
    .option('--message-id <id>', 'Create thread from a message')
    .action(
      async (
        botId: string,
        options: { message?: string; messageId?: string; target: string; threadName: string },
      ) => {
        const client = await getTrpcClient();
        const result = await client.botMessage.createThread.mutate({
          botId,
          channelId: options.target,
          content: options.message,
          messageId: options.messageId,
          name: options.threadName,
        });

        const r = result as any;
        console.log(
          `${pc.green('✓')} Thread created${r.threadId ? ` (${pc.dim(r.threadId)})` : ''}`,
        );
      },
    );

  thread
    .command('list <botId>')
    .description('List threads in a channel')
    .requiredOption('--target <channelId>', 'Channel ID')
    .option('--json', 'Output JSON')
    .action(async (botId: string, options: { json?: boolean; target: string }) => {
      const client = await getTrpcClient();
      const result = await client.botMessage.listThreads.query({
        botId,
        channelId: options.target,
      });

      if (options.json) {
        outputJson(result);
        return;
      }

      const threads = (result as any).threads ?? [];
      if (threads.length === 0) {
        console.log('No threads found.');
        return;
      }

      const rows = threads.map((t: any) => [
        t.id || '',
        t.name || '',
        String(t.messageCount ?? ''),
      ]);

      printTable(rows, ['ID', 'NAME', 'MESSAGES']);
    });

  thread
    .command('reply <botId>')
    .description('Reply to a thread')
    .requiredOption('--thread-id <id>', 'Thread ID')
    .requiredOption('--message <text>', 'Reply content')
    .action(async (botId: string, options: { message: string; threadId: string }) => {
      const client = await getTrpcClient();
      const result = await client.botMessage.replyToThread.mutate({
        botId,
        content: options.message,
        threadId: options.threadId,
      });

      const r = result as any;
      console.log(`${pc.green('✓')} Reply sent${r.messageId ? ` (${pc.dim(r.messageId)})` : ''}`);
    });

  // ── channel (subcommand group) ──────────────────────────

  const channel = message.command('channel').description('Manage channels');

  channel
    .command('list <botId>')
    .description('List channels')
    .option('--server-id <id>', 'Server / workspace ID')
    .option('--filter <type>', 'Filter by type')
    .option('--json', 'Output JSON')
    .action(
      async (botId: string, options: { filter?: string; json?: boolean; serverId?: string }) => {
        const client = await getTrpcClient();
        const result = await client.botMessage.listChannels.query({
          botId,
          filter: options.filter,
          serverId: options.serverId,
        });

        if (options.json) {
          outputJson(result);
          return;
        }

        const channels = (result as any).channels ?? [];
        if (channels.length === 0) {
          console.log('No channels found.');
          return;
        }

        const rows = channels.map((c: any) => [c.id || '', c.name || '', c.type || '']);
        printTable(rows, ['ID', 'NAME', 'TYPE']);
      },
    );

  channel
    .command('info <botId>')
    .description('Get channel details')
    .requiredOption('--target <channelId>', 'Channel ID')
    .option('--json', 'Output JSON')
    .action(async (botId: string, options: { json?: boolean; target: string }) => {
      const client = await getTrpcClient();
      const result = await client.botMessage.getChannelInfo.query({
        botId,
        channelId: options.target,
      });

      if (options.json) {
        outputJson(result);
        return;
      }

      const r = result as any;
      console.log(`Channel: ${pc.bold(r.name || options.target)}`);
      if (r.type) console.log(`  Type: ${r.type}`);
      if (r.memberCount != null) console.log(`  Members: ${r.memberCount}`);
      if (r.description) console.log(`  Description: ${r.description}`);
    });

  // ── member ──────────────────────────────────────────────

  const member = message.command('member').description('Member information');

  member
    .command('info <botId>')
    .description('Get member details')
    .requiredOption('--member-id <id>', 'Member / user ID')
    .option('--server-id <id>', 'Server / workspace ID')
    .option('--json', 'Output JSON')
    .action(
      async (botId: string, options: { json?: boolean; memberId: string; serverId?: string }) => {
        const client = await getTrpcClient();
        const result = await client.botMessage.getMemberInfo.query({
          botId,
          memberId: options.memberId,
          serverId: options.serverId,
        });

        if (options.json) {
          outputJson(result);
          return;
        }

        const r = result as any;
        console.log(`Member: ${pc.bold(r.displayName || r.username || options.memberId)}`);
        if (r.status) console.log(`  Status: ${r.status}`);
        if (r.roles?.length) console.log(`  Roles: ${r.roles.join(', ')}`);
      },
    );
}

// ── Helpers ──────────────────────────────────────────────

function collectOptions(value: string, previous: string[]): string[] {
  return [...previous, value];
}
