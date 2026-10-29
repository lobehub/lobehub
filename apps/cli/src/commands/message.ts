import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { isMissingProcedure } from '../utils/error';
import {
  confirm,
  formatTimestamp,
  outputJson,
  printTable,
  timeAgo,
  truncate,
} from '../utils/format';
import { log } from '../utils/logger';
import type { TimeWindow } from '../utils/timeWindow';
import { parseTimeWindow, TIME_POINT_HELP } from '../utils/timeWindow';
import { resolveUrlBuilder, resourcePath, withUrls } from './resourceUrl';

interface MessageSearchOptions {
  agentId?: string;
  exact?: boolean;
  includeSystem?: boolean;
  json?: string | boolean;
  limit?: string;
  page?: string;
  role?: string;
  since?: string;
  topicId?: string;
  until?: string;
  user?: boolean;
}

const TRUNCATION_NOTE =
  'Only the most relevant matches were considered; narrow with --since/--until or --topic-id to see the rest.';

const printTruncationNote = () => console.log(pc.yellow(TRUNCATION_NOTE));

/**
 * `--json` consumers read stdout, so the caveat rides on stderr: an extra field
 * would break both the bare-array contract and `--json <fields>` shaping, while
 * dropping it silently hides that lower-ranked matches were cut.
 */
const warnTruncationNote = () => console.error(pc.yellow(TRUNCATION_NOTE));

export function registerMessageCommand(program: Command) {
  const message = program.command('message').description('Manage messages');

  // ── list ──────────────────────────────────────────────

  message
    .command('list')
    .description('List messages')
    .option('--topic-id <id>', 'Filter by topic ID')
    .option('--agent-id <id>', 'Filter by agent ID')
    .option('--role <role>', 'Filter by role (user, assistant, tool, system)')
    .option('--start <date>', 'Only messages created at/after this date (ISO or YYYY-MM-DD)')
    .option('--end <date>', 'Only messages created at/before this date (ISO or YYYY-MM-DD)')
    .option('-L, --limit <n>', 'Page size', '50')
    .option('-P, --page <n>', 'Page number', '1')
    .option('--user', 'Shorthand for --role user')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (options: {
        agentId?: string;
        end?: string;
        json?: string | boolean;
        limit?: string;
        page?: string;
        role?: string;
        start?: string;
        topicId?: string;
        user?: boolean;
      }) => {
        const client = await getTrpcClient();

        const pageSize = options.limit ? Number.parseInt(options.limit, 10) : undefined;
        const current = options.page
          ? Math.max(Number.parseInt(options.page, 10) - 1, 0)
          : undefined;

        const input: Record<string, any> = {};
        if (options.topicId) input.topicId = options.topicId;
        if (options.agentId) input.agentId = options.agentId;
        if (options.user) input.role = 'user';
        if (options.role) input.role = options.role;
        if (options.start) input.startDate = options.start;
        if (options.end) input.endDate = options.end;
        if (pageSize) input.pageSize = pageSize;
        if (current) input.current = current;

        const result = await client.message.listAll.query(input as any);
        const items: any[] = Array.isArray(result) ? result : [];

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(
            withUrls(items, await resolveUrlBuilder(client), resourcePath.message),
            fields,
          );
          return;
        }

        if (items.length === 0) {
          console.log('No messages found.');
          return;
        }

        const rows = items.map((m: any) => [
          m.id || '',
          m.role || '',
          m.agentName || m.agentTitle || '',
          truncate(m.content || '', 60),
          m.threadId ? `${m.topicId || ''} › ${m.threadId}` : m.topicId || '',
          m.createdAt ? timeAgo(m.createdAt) : '',
        ]);

        printTable(rows, ['ID', 'ROLE', 'AGENT', 'CONTENT', 'TOPIC/THREAD', 'CREATED']);
      },
    );

  // ── search ────────────────────────────────────────────

  message
    .command('search <keywords>')
    .description(
      'Search messages, newest first. System-written prompts of task/cron/eval runs are hidden unless --include-system',
    )
    .option('--since <when>', `Only messages created at/after this time (${TIME_POINT_HELP})`)
    .option('--until <when>', `Only messages created at/before this time (${TIME_POINT_HELP})`)
    .option('--role <roles>', 'Filter by role, comma-separated (user, assistant, system, task)')
    .option('--user', 'Shorthand for --role user')
    .option('--topic-id <id>', 'Only messages in this topic')
    .option('--agent-id <id>', 'Only messages of this agent')
    .option(
      '--exact',
      'Case-sensitive whole-term match (STAMP will not match "stamp" or "STAMPED")',
    )
    .option('--include-system', 'Include system-written prompts of task, cron and eval runs')
    .option('-L, --limit <n>', 'Page size (max 100)', '20')
    .option('-P, --page <n>', 'Page number', '1')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (keywords: string, options: MessageSearchOptions) => {
      let window: TimeWindow;
      try {
        window = parseTimeWindow(options);
      } catch (error) {
        log.error((error as Error).message);
        process.exit(1);
        return;
      }

      const limit = Math.min(Math.max(Number.parseInt(options.limit || '20', 10) || 20, 1), 100);
      const page = Math.max(Number.parseInt(options.page || '1', 10) || 1, 1);
      const roles = options.user
        ? ['user']
        : options.role
            ?.split(',')
            .map((role) => role.trim())
            .filter(Boolean);

      const input = {
        keywords,
        limit,
        offset: (page - 1) * limit,
        ...window,
        ...(options.agentId && { agentId: options.agentId }),
        ...(options.exact && { exact: true }),
        ...(options.includeSystem && { includeAutomatedPrompts: true }),
        ...(roles?.length && { roles }),
        ...(options.topicId && { topicId: options.topicId }),
      };

      const client = await getTrpcClient();
      let result: { hasMore: boolean; items: any[]; truncated?: boolean };
      try {
        result = await client.message.searchByKeyword.query(input);
      } catch (error) {
        if (!isMissingProcedure(error)) throw error;
        // Older servers only expose the unfiltered search.
        const usesNewOptions =
          Object.keys(window).length > 0 ||
          options.agentId ||
          options.exact ||
          options.includeSystem ||
          roles?.length ||
          options.topicId ||
          page > 1;
        if (usesNewOptions) {
          log.error(
            'This server does not support filtered message search yet. Retry without filters, or upgrade the server.',
          );
          process.exit(1);
          return;
        }
        const legacy = await client.message.searchMessages.query({ keywords });
        const items = Array.isArray(legacy) ? legacy : [];
        result = { hasMore: items.length > limit, items: items.slice(0, limit) };
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(
          withUrls(result.items, await resolveUrlBuilder(client), resourcePath.message),
          fields,
        );
        if (result.truncated) warnTruncationNote();
        return;
      }

      if (result.items.length === 0) {
        console.log('No messages found.');
        // Hydration-only filters can empty a page cut from a truncated pool.
        if (result.truncated) printTruncationNote();
        return;
      }

      const rows = result.items.map((m: any) => [
        m.id || '',
        m.createdAt ? formatTimestamp(m.createdAt) : '',
        m.role || '',
        truncate(m.topicTitle || m.topicId || '', 24),
        truncate(m.snippet ?? m.content ?? '', 72),
      ]);

      printTable(rows, ['ID', 'CREATED', 'ROLE', 'TOPIC', 'MATCH']);

      if (result.hasMore) {
        console.log(pc.dim(`\nMore results: add -P ${page + 1}`));
      }
      if (result.truncated) printTruncationNote();
    });

  // ── delete ────────────────────────────────────────────

  message
    .command('delete <ids...>')
    .description('Delete one or more messages')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (ids: string[], options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm(
          `Are you sure you want to delete ${ids.length} message(s)?`,
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();

      if (ids.length === 1) {
        await client.message.removeMessage.mutate({ id: ids[0] });
      } else {
        await client.message.removeMessages.mutate({ ids });
      }

      console.log(`${pc.green('✓')} Deleted ${ids.length} message(s)`);
    });

  // ── count ─────────────────────────────────────────────

  message
    .command('count')
    .description('Count messages, optionally grouped by topic')
    .option('--topic-id <id>', 'Filter by topic ID')
    .option('--agent-id <id>', 'Filter by agent ID')
    .option('--role <role>', 'Filter by role (user, assistant, system)')
    .option('--start <date>', 'Start date (ISO format)')
    .option('--end <date>', 'End date (ISO format)')
    .option('--group-by <field>', 'Group counts by field (topic)')
    .option('--json', 'Output JSON')
    .action(
      async (options: {
        agentId?: string;
        end?: string;
        groupBy?: string;
        json?: boolean;
        role?: string;
        start?: string;
        topicId?: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {};
        if (options.topicId) input.topicId = options.topicId;
        if (options.agentId) input.agentId = options.agentId;
        if (options.role) input.role = options.role;
        if (options.start) input.startDate = options.start;
        if (options.end) input.endDate = options.end;

        if (options.groupBy && options.groupBy !== 'topic') {
          log.error(`Unsupported --group-by "${options.groupBy}". Only "topic" is supported.`);
          process.exit(1);
        }

        if (options.groupBy === 'topic') {
          const rows = (await client.message.countByTopic.query(input as any)) as {
            count: number;
            topicId: string;
          }[];

          if (options.json) {
            console.log(JSON.stringify(rows));
            return;
          }

          if (rows.length === 0) {
            console.log('No messages.');
            return;
          }

          printTable(
            rows.map((r) => [r.topicId, String(r.count)]),
            ['TOPIC', 'COUNT'],
          );
          return;
        }

        const count = await client.message.count.query(input as any);

        if (options.json) {
          console.log(JSON.stringify({ count }));
          return;
        }

        console.log(`Messages: ${pc.bold(String(count))}`);
      },
    );

  // ── stats ─────────────────────────────────────────────

  message
    .command('stats')
    .description('Distribution of message counts per topic (mean/median/p90/p99/one-shot)')
    .option('--agent-id <id>', 'Filter by agent ID')
    .option('--role <role>', 'Filter by role (default: user)')
    .option('--all-roles', 'Include every role instead of only user messages')
    .option('--start <date>', 'Start date (ISO format)')
    .option('--end <date>', 'End date (ISO format)')
    .option('--json', 'Output JSON')
    .action(
      async (options: {
        agentId?: string;
        allRoles?: boolean;
        end?: string;
        json?: boolean;
        role?: string;
        start?: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {};
        if (options.agentId) input.agentId = options.agentId;
        // Default to user messages — the common "how many turns per topic" question.
        if (!options.allRoles) input.role = options.role || 'user';
        else if (options.role) input.role = options.role;
        if (options.start) input.startDate = options.start;
        if (options.end) input.endDate = options.end;

        const stats = (await client.message.topicStats.query(input as any)) as {
          histogram: { topics: number; userCount: number }[];
          max: number;
          mean: number;
          median: number;
          min: number;
          oneshot: number;
          oneshotRatio: number;
          p90: number;
          p99: number;
          topics: number;
          totalMessages: number;
        };

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
          return;
        }

        if (stats.topics === 0) {
          console.log('No topics match the given filters.');
          return;
        }

        const round = (n: number) => Math.round(n * 100) / 100;
        printTable(
          [
            ['Topics', String(stats.topics)],
            ['Total messages', String(stats.totalMessages)],
            ['Mean', String(round(stats.mean))],
            ['Median', String(round(stats.median))],
            ['P90', String(round(stats.p90))],
            ['P99', String(round(stats.p99))],
            ['Min', String(stats.min)],
            ['Max', String(stats.max)],
            ['One-shot', `${stats.oneshot} (${(stats.oneshotRatio * 100).toFixed(1)}%)`],
          ],
          ['METRIC', 'VALUE'],
        );
      },
    );

  // ── create ────────────────────────────────────────────

  message
    .command('create')
    .description('Create a message')
    .requiredOption('-r, --role <role>', 'Message role (user, assistant, system)')
    .requiredOption('-c, --content <content>', 'Message content')
    .option('--agent-id <id>', 'Agent ID')
    .option('--topic-id <id>', 'Topic ID')
    .option('--session-id <id>', 'Session ID')
    .option('--json', 'Output JSON')
    .action(
      async (options: {
        agentId?: string;
        content: string;
        json?: boolean;
        role: string;
        sessionId?: string;
        topicId?: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {
          content: options.content,
          role: options.role,
        };
        if (options.agentId) input.agentId = options.agentId;
        if (options.topicId) input.topicId = options.topicId;
        if (options.sessionId) input.sessionId = options.sessionId;

        const result = await client.message.createMessage.mutate(input as any);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const r = result as any;
        console.log(`${pc.green('✓')} Created message ${pc.bold(r.id || '')}`);
      },
    );

  // ── edit ────────────────────────────────────────────

  message
    .command('edit <id>')
    .description('Update a message')
    .option('-c, --content <content>', 'New content')
    .option('--role <role>', 'New role')
    .action(async (id: string, options: { content?: string; role?: string }) => {
      const value: Record<string, any> = {};
      if (options.content) value.content = options.content;
      if (options.role) value.role = options.role;

      if (Object.keys(value).length === 0) {
        log.error('No changes specified. Use --content or --role.');
        process.exit(1);
      }

      const client = await getTrpcClient();
      await client.message.update.mutate({ id, value } as any);
      console.log(`${pc.green('✓')} Updated message ${pc.bold(id)}`);
    });

  // ── add-files ───────────────────────────────────────

  message
    .command('add-files <id>')
    .description('Add files to a message')
    .requiredOption('--file-ids <ids>', 'Comma-separated file IDs')
    .action(async (id: string, options: { fileIds: string }) => {
      const fileIds = options.fileIds.split(',').map((s) => s.trim());

      const client = await getTrpcClient();
      await client.message.addFilesToMessage.mutate({ fileIds, id } as any);
      console.log(`${pc.green('✓')} Added ${fileIds.length} file(s) to message ${pc.bold(id)}`);
    });

  // ── word-count ──────────────────────────────────────

  message
    .command('word-count')
    .description('Count total words in messages')
    .option('--start <date>', 'Start date (ISO format)')
    .option('--end <date>', 'End date (ISO format)')
    .option('--json', 'Output JSON')
    .action(async (options: { end?: string; json?: boolean; start?: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = {};
      if (options.start) input.startDate = options.start;
      if (options.end) input.endDate = options.end;

      const count = await client.message.countWords.query(input as any);

      if (options.json) {
        console.log(JSON.stringify({ wordCount: count }));
        return;
      }

      console.log(`Word count: ${pc.bold(String(count))}`);
    });

  // ── rank-models ─────────────────────────────────────

  message
    .command('rank-models')
    .description('Rank models by message usage')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const result = await client.message.rankModels.query();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const items = Array.isArray(result) ? result : [];
      if (items.length === 0) {
        console.log('No model usage data.');
        return;
      }

      const rows = items.map((m: any) => [m.id || m.model || '', String(m.count || 0)]);
      printTable(rows, ['MODEL', 'COUNT']);
    });

  // ── delete-by-assistant ─────────────────────────────

  message
    .command('delete-by-assistant')
    .description('Delete messages by assistant context')
    .option('--agent-id <id>', 'Agent ID')
    .option('--session-id <id>', 'Session ID')
    .option('--topic-id <id>', 'Topic ID')
    .option('--yes', 'Skip confirmation prompt')
    .action(
      async (options: {
        agentId?: string;
        sessionId?: string;
        topicId?: string;
        yes?: boolean;
      }) => {
        if (!options.agentId && !options.sessionId) {
          log.error('Specify at least --agent-id or --session-id.');
          process.exit(1);
        }

        if (!options.yes) {
          const confirmed = await confirm('Are you sure you want to delete messages by assistant?');
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const client = await getTrpcClient();
        const input: Record<string, any> = {};
        if (options.agentId) input.agentId = options.agentId;
        if (options.sessionId) input.sessionId = options.sessionId;
        if (options.topicId) input.topicId = options.topicId;

        await client.message.removeMessagesByAssistant.mutate(input as any);
        console.log(`${pc.green('✓')} Deleted messages by assistant`);
      },
    );

  // ── delete-by-group ─────────────────────────────────

  message
    .command('delete-by-group <groupId>')
    .description('Delete messages by group')
    .option('--topic-id <id>', 'Topic ID')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (groupId: string, options: { topicId?: string; yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete messages by group?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      const input: Record<string, any> = { groupId };
      if (options.topicId) input.topicId = options.topicId;

      await client.message.removeMessagesByGroup.mutate(input as any);
      console.log(`${pc.green('✓')} Deleted messages for group ${pc.bold(groupId)}`);
    });

  // ── heatmap ───────────────────────────────────────────

  message
    .command('heatmap')
    .description('Get message activity heatmap')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const result = await client.message.getHeatmaps.query();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result || (Array.isArray(result) && result.length === 0)) {
        console.log('No heatmap data.');
        return;
      }

      // Display as simple list
      const items = Array.isArray(result) ? result : [result];
      for (const entry of items) {
        const e = entry as any;
        console.log(`${e.date || e.day || ''}: ${pc.bold(String(e.count || e.value || 0))}`);
      }
    });
}
