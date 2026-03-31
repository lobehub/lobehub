import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../../utils/format';
import { log } from '../../utils/logger';
import { statusBadge } from './helpers';

export function registerTopicCommands(task: Command) {
  // ── topic ──────────────────────────────────────────────

  const tp = task.command('topic').description('Manage task topics');

  tp.command('list <id>')
    .description('List topics for a task')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.task.getTopics.query({ id });

      if (options.json !== undefined) {
        outputJson(result.data, options.json);
        return;
      }

      if (!result.data || result.data.length === 0) {
        log.info('No topics found for this task.');
        return;
      }

      const rows = result.data.map((t: any) => [
        `#${t.seq}`,
        t.id,
        statusBadge(t.status || 'running'),
        truncate(t.title || 'Untitled', 40),
        t.operationId ? pc.dim(truncate(t.operationId, 20)) : '-',
        timeAgo(t.createdAt),
      ]);

      printTable(rows, ['SEQ', 'TOPIC ID', 'STATUS', 'TITLE', 'OPERATION', 'CREATED']);
    });

  tp.command('view <id> <topicId>')
    .description('View messages of a topic (topicId can be a seq number like "1")')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, topicId: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();

      let resolvedTopicId = topicId;

      // If it's a number, treat as seq index
      const seqNum = Number.parseInt(topicId, 10);
      if (!Number.isNaN(seqNum) && String(seqNum) === topicId) {
        const topicsResult = await client.task.getTopics.query({ id });
        const match = (topicsResult.data || []).find((t: any) => t.seq === seqNum);
        if (!match) {
          log.error(`Topic #${seqNum} not found for this task.`);
          return;
        }
        resolvedTopicId = match.id;
        log.info(
          `Topic #${seqNum}: ${pc.bold(match.title || 'Untitled')} ${pc.dim(resolvedTopicId)}`,
        );
      }

      const messages = await client.message.getMessages.query({ topicId: resolvedTopicId });
      const items = Array.isArray(messages) ? messages : [];

      if (options.json !== undefined) {
        outputJson(items, options.json);
        return;
      }

      if (items.length === 0) {
        log.info('No messages in this topic.');
        return;
      }

      console.log();
      for (const msg of items) {
        const role =
          msg.role === 'assistant'
            ? pc.green('Assistant')
            : msg.role === 'user'
              ? pc.blue('User')
              : pc.dim(msg.role);

        console.log(`${pc.bold(role)} ${pc.dim(timeAgo(msg.createdAt))}`);
        if (msg.content) {
          console.log(msg.content);
        }
        console.log();
      }
    });

  tp.command('cancel <topicId>')
    .description('Cancel a running topic and pause the task')
    .action(async (topicId: string) => {
      const client = await getTrpcClient();
      await client.task.cancelTopic.mutate({ topicId });
      log.info(`Topic ${pc.bold(topicId)} canceled. Task paused.`);
    });

  tp.command('delete <topicId>')
    .description('Delete a topic and its messages')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (topicId: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const ok = await confirm(`Delete topic ${pc.bold(topicId)} and all its messages?`);
        if (!ok) return;
      }

      const client = await getTrpcClient();
      await client.task.deleteTopic.mutate({ topicId });
      log.info(`Topic ${pc.bold(topicId)} deleted.`);
    });
}
