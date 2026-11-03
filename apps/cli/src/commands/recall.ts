import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { isMissingProcedure } from '../utils/error';
import { formatTimestamp, outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';
import type { TimeWindow } from '../utils/timeWindow';
import { parseTimeWindow, TIME_POINT_HELP } from '../utils/timeWindow';

const RECALL_TYPES = ['message', 'topic', 'goal', 'page'] as const;
type RecallType = (typeof RECALL_TYPES)[number];

interface RecallOptions {
  exact?: boolean;
  includeSystem?: boolean;
  json?: string | boolean;
  limit?: string;
  since?: string;
  type?: string;
  until?: string;
}

const section = (title: string, count: number, more = false) => {
  console.log();
  console.log(pc.bold(pc.cyan(`── ${title} (${count}${more ? '+' : ''}) ──`)));
};

const when = (value?: Date | string | null) => (value ? formatTimestamp(value) : '');

export function registerRecallCommand(program: Command) {
  program
    .command('recall <query>')
    .description(
      'Recall what happened around a topic: matching messages, conversations, goals and pages in one time window',
    )
    .option('--since <when>', `Window start (${TIME_POINT_HELP})`)
    .option('--until <when>', `Window end (${TIME_POINT_HELP})`)
    .option('-t, --type <types>', `Only these types, comma-separated: ${RECALL_TYPES.join(', ')}`)
    .option(
      '--exact',
      'Case-sensitive whole-term match for messages (STAMP will not match "stamp" or "STAMPED")',
    )
    .option('--include-system', 'Include system-written prompts of task, cron and eval runs')
    .option('-L, --limit <n>', 'Results per type (max 50)', '10')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .addHelpText(
      'after',
      `
Examples:
  $ lh recall STAMP --since 7d
  $ lh recall "replica" --since 2026-10-12 --until 2026-10-18 --exact
  $ lh recall 安全信道 -t message,topic --json

Topics combine title matches with the conversations whose messages matched.
Follow up with \`lh topic view <id>\`, \`lh goal show <id>\` or \`lh doc view <id>\`.`,
    )
    .action(async (query: string, options: RecallOptions) => {
      let window: TimeWindow;
      try {
        window = parseTimeWindow(options);
      } catch (error) {
        log.error((error as Error).message);
        process.exit(1);
        return;
      }

      const types = options.type
        ?.split(',')
        .map((type) => type.trim())
        .filter(Boolean);
      const invalid = types?.filter((type) => !RECALL_TYPES.includes(type as RecallType));
      if (invalid?.length) {
        log.error(
          `Invalid type: ${invalid.join(', ')}. Must be one of: ${RECALL_TYPES.join(', ')}`,
        );
        process.exit(1);
        return;
      }

      const limitPerType = Math.min(
        Math.max(Number.parseInt(options.limit || '10', 10) || 10, 1),
        50,
      );

      const client = await getTrpcClient();
      let result: any;
      try {
        result = await client.search.recall.query({
          limitPerType,
          query,
          ...window,
          ...(options.exact && { exact: true }),
          ...(options.includeSystem && { includeAutomatedPrompts: true }),
          ...(types?.length && { types: types as RecallType[] }),
        });
      } catch (error) {
        if (!isMissingProcedure(error)) throw error;
        log.error(
          'This server does not support recall yet. Use `lh message search` and `lh search` instead, or upgrade the server.',
        );
        process.exit(1);
        return;
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      const {
        goals = [],
        messages = { hasMore: false, items: [], truncated: false },
        pages = [],
        topics = [],
      } = result ?? {};

      // Hydration-only filters can empty the message page even when the
      // provider pool was cut, so the caveat must survive an empty section.
      const printTruncationNote = () => {
        if (!messages.truncated) return;
        console.log(
          pc.yellow(
            'Only the most relevant message matches were considered; narrow --since/--until to see the rest.',
          ),
        );
      };

      if (!goals.length && !messages.items.length && !pages.length && !topics.length) {
        console.log('Nothing found in this window.');
        printTruncationNote();
        return;
      }

      if (goals.length) {
        section('goal', goals.length);
        printTable(
          goals.map((goal: any) => [
            goal.id,
            goal.status || '',
            truncate(goal.title || '', 56),
            when(goal.updatedAt),
          ]),
          ['ID', 'STATUS', 'TITLE', 'UPDATED'],
        );
      }

      if (topics.length) {
        section('topic', topics.length);
        printTable(
          topics.map((topic: any) => [
            topic.id,
            truncate(topic.title || 'Untitled', 48),
            topic.hitCount ? String(topic.hitCount) : '-',
            (topic.matchedBy || []).join('+'),
            when(topic.lastMatchedAt || topic.updatedAt),
          ]),
          ['ID', 'TITLE', 'HITS', 'MATCHED', 'LAST'],
        );
      }

      if (messages.items.length) {
        section('message', messages.items.length, messages.hasMore);
        printTable(
          messages.items.map((message: any) => [
            message.id,
            when(message.createdAt),
            message.role || '',
            truncate(message.topicTitle || message.topicId || '', 24),
            truncate(message.snippet || '', 64),
          ]),
          ['ID', 'CREATED', 'ROLE', 'TOPIC', 'MATCH'],
        );
        if (messages.hasMore) {
          console.log(
            pc.dim(
              'More messages: `lh message search` with the same query, --since and --until pages through all of them',
            ),
          );
        }
      }

      if (pages.length) {
        section('page', pages.length);
        printTable(
          pages.map((page: any) => [
            page.id,
            truncate(page.title || 'Untitled', 56),
            when(page.updatedAt),
          ]),
          ['ID', 'TITLE', 'UPDATED'],
        );
      }

      printTruncationNote();
    });
}
