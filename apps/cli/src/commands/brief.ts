import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerBriefCommand(program: Command) {
  const brief = program.command('brief').description('Manage briefs (Agent reports)');

  // ── list ──────────────────────────────────────────────

  brief
    .command('list')
    .description('List briefs')
    .option('--unresolved', 'Only show unresolved briefs (default)')
    .option('--all', 'Show all briefs')
    .option('--type <type>', 'Filter by type (decision/result/insight/error)')
    .option('-L, --limit <n>', 'Page size', '50')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        all?: boolean;
        json?: string | boolean;
        limit?: string;
        type?: string;
        unresolved?: boolean;
      }) => {
        const client = await getTrpcClient();

        let items: any[];

        if (options.all) {
          const input: Record<string, any> = {};
          if (options.type) input.type = options.type;
          if (options.limit) input.limit = Number.parseInt(options.limit, 10);
          const result = await client.brief.list.query(input as any);
          items = result.data;
        } else {
          const result = await client.brief.listUnresolved.query();
          items = result.data;
        }

        if (options.json !== undefined) {
          outputJson(items, typeof options.json === 'string' ? options.json : undefined);
          return;
        }

        if (!items || items.length === 0) {
          log.info('No briefs found.');
          return;
        }

        const rows = items.map((b: any) => [
          typeBadge(b.type, b.priority),
          truncate(b.title, 40),
          truncate(b.summary, 50),
          b.taskId ? pc.dim(b.taskId) : b.cronJobId ? pc.dim(b.cronJobId) : '-',
          b.resolvedAt ? pc.green('resolved') : b.readAt ? pc.dim('read') : 'new',
          timeAgo(b.createdAt),
        ]);

        printTable(rows, ['TYPE', 'TITLE', 'SUMMARY', 'SOURCE', 'STATUS', 'CREATED']);
      },
    );

  // ── view ──────────────────────────────────────────────

  brief
    .command('view <id>')
    .description('View brief details (auto marks as read)')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.brief.find.query({ id });
      const b = result.data;

      if (options.json !== undefined) {
        outputJson(b, typeof options.json === 'string' ? options.json : undefined);
        return;
      }

      if (!b) {
        log.error('Brief not found.');
        return;
      }

      // Auto mark as read
      if (!b.readAt) {
        await client.brief.markRead.mutate({ id });
      }

      const resolvedLabel = b.resolvedAt
        ? (() => {
            const actions = (b.actions as any[]) || [];
            const matched = actions.find((a: any) => a.key === (b as any).resolvedAction);
            return pc.green(` ${matched?.label || '✓ resolved'}`);
          })()
        : '';

      console.log(`\n${typeBadge(b.type, b.priority)} ${pc.bold(b.title)}${resolvedLabel}`);
      console.log(`${pc.dim('Type:')} ${b.type}  ${pc.dim('Created:')} ${timeAgo(b.createdAt)}`);
      if (b.agentId) console.log(`${pc.dim('Agent:')} ${b.agentId}`);
      if (b.taskId) console.log(`${pc.dim('Task:')} ${b.taskId}`);
      if (b.cronJobId) console.log(`${pc.dim('CronJob:')} ${b.cronJobId}`);
      if (b.topicId) console.log(`${pc.dim('Topic:')} ${b.topicId}`);
      console.log(`\n${b.summary}`);

      if (b.artifacts && (b.artifacts as string[]).length > 0) {
        console.log(`\n${pc.dim('Artifacts:')}`);
        for (const a of b.artifacts as string[]) {
          console.log(`  📎 ${a}`);
        }
      }

      console.log();
      if (!b.resolvedAt) {
        const actions = (b.actions as any[]) || [];
        if (actions.length > 0) {
          console.log('Actions:');
          for (const a of actions) {
            const cmd =
              a.type === 'comment'
                ? `lh brief resolve ${b.id} --action ${a.key} -m "内容"`
                : `lh brief resolve ${b.id} --action ${a.key}`;
            console.log(`  ${a.label}  ${pc.dim(cmd)}`);
          }
        } else {
          console.log(pc.dim('Actions:'));
          console.log(pc.dim(`  lh brief resolve ${b.id}                   # 确认通过`));
          console.log(pc.dim(`  lh brief resolve ${b.id} --reply "修改意见"  # 反馈修改`));
        }
      } else if ((b as any).resolvedComment) {
        console.log(`${pc.dim('Comment:')} ${(b as any).resolvedComment}`);
      }
    });

  // ── resolve ──────────────────────────────────────────────

  brief
    .command('resolve <id>')
    .description('Resolve a brief (approve, reply, or custom action)')
    .option('--action <key>', 'Execute a specific action (e.g. approve, feedback)')
    .option('--reply <text>', 'Reply with feedback')
    .option('-m, --message <text>', 'Message for comment-type actions')
    .action(async (id: string, options: { action?: string; message?: string; reply?: string }) => {
      const client = await getTrpcClient();

      const actionKey = options.action || (options.reply ? 'feedback' : 'approve');
      const actionMessage = options.message || options.reply;

      const briefResult = await client.brief.find.query({ id });
      const b = briefResult.data;

      // For comment-type actions, add comment to task
      if (actionMessage && b?.taskId) {
        await client.task.addComment.mutate({
          briefId: id,
          content: actionMessage,
          id: b.taskId,
        });
      }

      await client.brief.resolve.mutate({
        action: actionKey,
        comment: actionMessage,
        id,
      });

      const actions = (b?.actions as any[]) || [];
      const matchedAction = actions.find((a: any) => a.key === actionKey);
      const label = matchedAction?.label || actionKey;

      log.info(`${label} — Brief ${pc.dim(id)} resolved.`);
    });

  // ── delete ──────────────────────────────────────────────

  brief
    .command('delete <id>')
    .description('Delete a brief')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      await client.brief.delete.mutate({ id });
      log.info(`Brief ${pc.dim(id)} deleted.`);
    });
}

function typeBadge(type: string, priority?: string): string {
  if (priority === 'urgent') {
    return pc.red('🔴');
  }

  switch (type) {
    case 'decision': {
      return pc.yellow('🟡');
    }
    case 'result': {
      return pc.green('✅');
    }
    case 'insight': {
      return '💬';
    }
    case 'error': {
      return pc.red('❌');
    }
    default: {
      return '·';
    }
  }
}
