import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import {
  confirm,
  displayWidth,
  outputJson,
  printTable,
  timeAgo,
  truncate,
} from '../../utils/format';
import { log } from '../../utils/logger';
import { registerCheckpointCommands } from './checkpoint';
import { registerDepCommands } from './dep';
import { registerDocCommands } from './doc';
import { briefIcon, priorityLabel, statusBadge } from './helpers';
import { registerLifecycleCommands } from './lifecycle';
import { registerReviewCommands } from './review';
import { registerTopicCommands } from './topic';

export function registerTaskCommand(program: Command) {
  const task = program.command('task').description('Manage agent tasks');

  // ── list ──────────────────────────────────────────────

  task
    .command('list')
    .description('List tasks')
    .option(
      '--status <status>',
      'Filter by status (pending/running/paused/completed/failed/canceled)',
    )
    .option('--root', 'Only show root tasks (no parent)')
    .option('--parent <id>', 'Filter by parent task ID')
    .option('--agent <id>', 'Filter by assignee agent ID')
    .option('-L, --limit <n>', 'Page size', '50')
    .option('--offset <n>', 'Offset', '0')
    .option('--tree', 'Display as tree structure')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        agent?: string;
        json?: string | boolean;
        limit?: string;
        offset?: string;
        parent?: string;
        root?: boolean;
        status?: string;
        tree?: boolean;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {};
        if (options.status) input.status = options.status;
        if (options.root) input.parentTaskId = null;
        if (options.parent) input.parentTaskId = options.parent;
        if (options.agent) input.assigneeAgentId = options.agent;
        if (options.limit) input.limit = Number.parseInt(options.limit, 10);
        if (options.offset) input.offset = Number.parseInt(options.offset, 10);

        // For tree mode, fetch all tasks (no pagination limit)
        if (options.tree) {
          input.limit = 100;
          delete input.offset;
        }

        const result = await client.task.list.query(input as any);

        if (options.json !== undefined) {
          outputJson(result.data, options.json);
          return;
        }

        if (!result.data || result.data.length === 0) {
          log.info('No tasks found.');
          return;
        }

        if (options.tree) {
          // Build tree display
          const taskMap = new Map<string, any>();
          for (const t of result.data) taskMap.set(t.id, t);

          const roots = result.data.filter((t: any) => !t.parentTaskId);
          const children = new Map<string, any[]>();
          for (const t of result.data) {
            if (t.parentTaskId) {
              const list = children.get(t.parentTaskId) || [];
              list.push(t);
              children.set(t.parentTaskId, list);
            }
          }

          // Sort children by sortOrder first, then seq
          for (const [, list] of children) {
            list.sort(
              (a: any, b: any) =>
                (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.seq ?? 0) - (b.seq ?? 0),
            );
          }

          const printNode = (t: any, prefix: string, isLast: boolean, isRoot: boolean) => {
            const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
            const name = truncate(t.name || t.instruction, 40);
            console.log(
              `${prefix}${connector}${pc.dim(t.identifier)} ${statusBadge(t.status)} ${name}`,
            );
            const childList = children.get(t.id) || [];
            const newPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
            childList.forEach((child: any, i: number) => {
              printNode(child, newPrefix, i === childList.length - 1, false);
            });
          };

          for (const root of roots) {
            printNode(root, '', true, true);
          }
          log.info(`Total: ${result.total}`);
          return;
        }

        const rows = result.data.map((t: any) => [
          pc.dim(t.identifier),
          truncate(t.name || t.instruction, 40),
          statusBadge(t.status),
          priorityLabel(t.priority),
          t.assigneeAgentId ? pc.dim(t.assigneeAgentId) : '-',
          t.parentTaskId ? pc.dim('↳ subtask') : '',
          timeAgo(t.createdAt),
        ]);

        printTable(rows, ['ID', 'NAME', 'STATUS', 'PRI', 'AGENT', 'TYPE', 'CREATED']);
        log.info(`Total: ${result.total}`);
      },
    );

  // ── view ──────────────────────────────────────────────

  task
    .command('view <id>')
    .description('View task details (by ID or identifier like T-1)')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();

      // ── Auto-detect by id prefix ──

      // docs_ → show document content
      if (id.startsWith('docs_')) {
        const doc = await client.document.getDocumentDetail.query({ id });

        if (options.json !== undefined) {
          outputJson(doc, options.json);
          return;
        }

        if (!doc) {
          log.error('Document not found.');
          return;
        }

        console.log(`\n📄 ${pc.bold(doc.title || 'Untitled')} ${pc.dim(doc.id)}`);
        if (doc.fileType) console.log(`${pc.dim('Type:')} ${doc.fileType}`);
        if (doc.totalCharCount) console.log(`${pc.dim('Size:')} ${doc.totalCharCount} chars`);
        console.log(`${pc.dim('Updated:')} ${timeAgo(doc.updatedAt)}`);
        console.log();
        if (doc.content) {
          console.log(doc.content);
        }
        return;
      }

      // tpc_ → show topic messages
      if (id.startsWith('tpc_')) {
        const messages = await client.message.getMessages.query({ topicId: id });
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
        return;
      }

      // Default: task detail
      const result = await client.task.detail.query({ id });

      if (options.json !== undefined) {
        outputJson(result.data, options.json);
        return;
      }

      const t = result.data;

      // ── Header ──
      console.log(`\n${pc.bold(t.identifier)} ${t.name || ''}`);
      console.log(
        `${pc.dim('Status:')} ${statusBadge(t.status)}  ${pc.dim('Priority:')} ${priorityLabel(t.priority)}`,
      );
      console.log(`${pc.dim('Instruction:')} ${t.instruction}`);
      if (t.description) console.log(`${pc.dim('Description:')} ${t.description}`);
      if (t.agentId) console.log(`${pc.dim('Agent:')} ${t.agentId}`);
      if (t.userId) console.log(`${pc.dim('User:')} ${t.userId}`);
      if (t.parent) {
        console.log(`${pc.dim('Parent:')} ${t.parent.identifier} ${t.parent.name || ''}`);
      }
      const topicInfo = t.topicCount ? `${t.topicCount}` : '0';
      const createdInfo = t.createdAt ? timeAgo(t.createdAt) : '-';
      console.log(`${pc.dim('Topics:')} ${topicInfo}  ${pc.dim('Created:')} ${createdInfo}`);
      if (t.heartbeat?.timeout && t.heartbeat.lastAt) {
        const hb = timeAgo(t.heartbeat.lastAt);
        const interval = t.heartbeat.interval ? `${t.heartbeat.interval}s` : '-';
        const elapsed = (Date.now() - new Date(t.heartbeat.lastAt).getTime()) / 1000;
        const isStuck = t.status === 'running' && elapsed > t.heartbeat.timeout;
        console.log(
          `${pc.dim('Heartbeat:')} ${isStuck ? pc.red(hb) : hb}  ${pc.dim('interval:')} ${interval}  ${pc.dim('timeout:')} ${t.heartbeat.timeout}s${isStuck ? pc.red('  ⚠ TIMEOUT') : ''}`,
        );
      }
      if (t.error) console.log(`${pc.red('Error:')} ${t.error}`);

      // ── Subtasks ──
      if (t.subtasks && t.subtasks.length > 0) {
        // Build lookup: which subtasks are completed
        const completedIdentifiers = new Set(
          t.subtasks.filter((s) => s.status === 'completed').map((s) => s.identifier),
        );

        console.log(`\n${pc.bold('Subtasks:')}`);
        for (const s of t.subtasks) {
          const depInfo = s.blockedBy ? pc.dim(` ← blocks: ${s.blockedBy}`) : '';
          // Show 'blocked' instead of 'backlog' if task has unresolved dependencies
          const isBlocked = s.blockedBy && !completedIdentifiers.has(s.blockedBy);
          const displayStatus = s.status === 'backlog' && isBlocked ? 'blocked' : s.status;
          console.log(
            `  ${pc.dim(s.identifier)} ${statusBadge(displayStatus)} ${s.name || '(unnamed)'}${depInfo}`,
          );
        }
      }

      // ── Dependencies ──
      if (t.dependencies && t.dependencies.length > 0) {
        console.log(`\n${pc.bold('Dependencies:')}`);
        for (const d of t.dependencies) {
          const depName = d.name ? ` ${d.name}` : '';
          console.log(`  ${pc.dim(d.type || 'blocks')}: ${d.dependsOn}${depName}`);
        }
      }

      // ── Checkpoint ──
      {
        const cp = t.checkpoint || {};
        console.log(`\n${pc.bold('Checkpoint:')}`);
        const hasConfig =
          cp.onAgentRequest !== undefined ||
          cp.topic?.before ||
          cp.topic?.after ||
          cp.tasks?.beforeIds?.length ||
          cp.tasks?.afterIds?.length;

        if (hasConfig) {
          if (cp.onAgentRequest !== undefined)
            console.log(`  onAgentRequest: ${cp.onAgentRequest}`);
          if (cp.topic?.before) console.log(`  topic.before: ${cp.topic.before}`);
          if (cp.topic?.after) console.log(`  topic.after: ${cp.topic.after}`);
          if (cp.tasks?.beforeIds?.length)
            console.log(`  tasks.before: ${cp.tasks.beforeIds.join(', ')}`);
          if (cp.tasks?.afterIds?.length)
            console.log(`  tasks.after: ${cp.tasks.afterIds.join(', ')}`);
        } else {
          console.log(`  ${pc.dim('(not configured, default: onAgentRequest=true)')}`);
        }
      }

      // ── Review ──
      {
        const rv = t.review as any;
        console.log(`\n${pc.bold('Review:')}`);
        if (rv && rv.enabled) {
          console.log(
            `  judge: ${rv.judge?.model || 'default'}${rv.judge?.provider ? ` (${rv.judge.provider})` : ''}`,
          );
          console.log(`  maxIterations: ${rv.maxIterations}  autoRetry: ${rv.autoRetry}`);
          if (rv.rubrics?.length > 0) {
            for (let i = 0; i < rv.rubrics.length; i++) {
              const rb = rv.rubrics[i];
              const threshold = rb.threshold ? ` ≥ ${Math.round(rb.threshold * 100)}%` : '';
              const typeTag = pc.dim(`[${rb.type}]`);
              let configInfo = '';
              if (rb.type === 'llm-rubric') configInfo = rb.config?.criteria || '';
              else if (rb.type === 'contains' || rb.type === 'equals')
                configInfo = `value="${rb.config?.value}"`;
              else if (rb.type === 'regex') configInfo = `pattern="${rb.config?.pattern}"`;
              console.log(`  ${i + 1}. ${rb.name} ${typeTag}${threshold} ${pc.dim(configInfo)}`);
            }
          }
        } else {
          console.log(`  ${pc.dim('(not configured)')}`);
        }
      }

      // ── Workspace ──
      {
        const nodes = t.workspace || [];
        if (nodes.length === 0) {
          console.log(`\n${pc.bold('Workspace:')}`);
          console.log(`  ${pc.dim('No documents yet.')}`);
        } else {
          const countNodes = (list: typeof nodes): number =>
            list.reduce((sum, n) => sum + 1 + (n.children ? countNodes(n.children) : 0), 0);
          console.log(`\n${pc.bold(`Workspace (${countNodes(nodes)}):`)}`);

          const formatSize = (chars: number | null | undefined) => {
            if (!chars) return '';
            if (chars >= 10_000) return `${(chars / 1000).toFixed(1)}k`;
            return `${chars}`;
          };

          const LEFT_COL = 56;
          const FROM_WIDTH = 10;

          const renderNodes = (list: typeof nodes, indent: string, isChild: boolean) => {
            for (let i = 0; i < list.length; i++) {
              const node = list[i];
              const isFolder = node.fileType === 'custom/folder';
              const isLast = i === list.length - 1;
              const icon = isFolder ? '📁' : '📄';
              const connector = isChild ? (isLast ? '└── ' : '├── ') : '';
              const prefix = `${indent}${connector}${icon} `;
              const titleStr = truncate(node.title || 'Untitled', LEFT_COL - displayWidth(prefix));
              const titlePad = ' '.repeat(
                Math.max(1, LEFT_COL - displayWidth(prefix) - displayWidth(titleStr)),
              );

              const fromStr = node.sourceTaskIdentifier ? `← ${node.sourceTaskIdentifier}` : '';
              const fromPad = ' '.repeat(Math.max(1, FROM_WIDTH - fromStr.length + 1));
              const size =
                !isFolder && node.size
                  ? formatSize(node.size).padStart(6) + ' chars'
                  : ''.padStart(12);

              const ago = node.createdAt ? `  ${timeAgo(node.createdAt)}` : '';

              console.log(
                `${prefix}${titleStr}${titlePad}${pc.dim(`(${node.documentId})`)}  ${fromStr}${fromPad}${pc.dim(size)}${pc.dim(ago)}`,
              );

              if (node.children && node.children.length > 0) {
                const childIndent = isChild ? indent + (isLast ? '    ' : '│   ') : indent;
                renderNodes(node.children, childIndent, true);
              }
            }
          };
          renderNodes(nodes, '  ', false);
        }
      }

      // ── Activities (already sorted desc by service) ──
      {
        console.log(`\n${pc.bold('Activities:')}`);
        const acts = t.activities || [];
        if (acts.length === 0) {
          console.log(`  ${pc.dim('No activities yet.')}`);
        } else {
          for (const act of acts) {
            const ago = act.time ? timeAgo(act.time) : '';
            const idSuffix = act.id ? `  ${pc.dim(act.id)}` : '';
            if (act.type === 'topic') {
              const sBadge = statusBadge(act.status || 'running');
              console.log(
                `  💬 ${pc.dim(ago.padStart(7))} Topic #${act.seq || '?'} ${act.title || 'Untitled'} ${sBadge}${idSuffix}`,
              );
            } else if (act.type === 'brief') {
              const icon = briefIcon(act.briefType || '');
              const pri =
                act.priority === 'urgent'
                  ? pc.red(' [urgent]')
                  : act.priority === 'normal'
                    ? pc.yellow(' [normal]')
                    : '';
              const resolved = act.resolvedAction ? pc.green(` ✏️ ${act.resolvedAction}`) : '';
              const typeLabel = pc.dim(`[${act.briefType}]`);
              console.log(
                `  ${icon} ${pc.dim(ago.padStart(7))} Brief ${typeLabel} ${act.title}${pri}${resolved}${idSuffix}`,
              );
            } else if (act.type === 'comment') {
              const author = act.agentId ? `🤖 ${act.agentId}` : '👤 user';
              console.log(`  💭 ${pc.dim(ago.padStart(7))} ${pc.cyan(author)} ${act.content}`);
            }
          }
        }
      }

      console.log();
    });

  // ── create ──────────────────────────────────────────────

  task
    .command('create')
    .description('Create a new task')
    .requiredOption('-i, --instruction <text>', 'Task instruction')
    .option('-n, --name <name>', 'Task name')
    .option('--agent <id>', 'Assign to agent')
    .option('--parent <id>', 'Parent task ID')
    .option('--priority <n>', 'Priority (0=none, 1=urgent, 2=high, 3=normal, 4=low)', '0')
    .option('--prefix <prefix>', 'Identifier prefix', 'T')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        agent?: string;
        instruction: string;
        json?: string | boolean;
        name?: string;
        parent?: string;
        prefix?: string;
        priority?: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {
          instruction: options.instruction,
        };
        if (options.name) input.name = options.name;
        if (options.agent) input.assigneeAgentId = options.agent;
        if (options.parent) input.parentTaskId = options.parent;
        if (options.priority) input.priority = Number.parseInt(options.priority, 10);
        if (options.prefix) input.identifierPrefix = options.prefix;

        const result = await client.task.create.mutate(input as any);

        if (options.json !== undefined) {
          outputJson(result.data, options.json);
          return;
        }

        log.info(`Task created: ${pc.bold(result.data.identifier)} ${result.data.name || ''}`);
      },
    );

  // ── edit ──────────────────────────────────────────────

  task
    .command('edit <id>')
    .description('Update a task')
    .option('-n, --name <name>', 'Task name')
    .option('-i, --instruction <text>', 'Task instruction')
    .option('--agent <id>', 'Assign to agent')
    .option('--priority <n>', 'Priority (0-4)')
    .option('--heartbeat-interval <n>', 'Heartbeat interval in seconds')
    .option('--heartbeat-timeout <n>', 'Heartbeat timeout in seconds (0 to disable)')
    .option('--description <text>', 'Task description')
    .option(
      '--status <status>',
      'Set status (backlog, running, paused, completed, failed, canceled)',
    )
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        id: string,
        options: {
          agent?: string;
          description?: string;
          heartbeatInterval?: string;
          heartbeatTimeout?: string;
          instruction?: string;
          json?: string | boolean;
          name?: string;
          priority?: string;
          status?: string;
        },
      ) => {
        const client = await getTrpcClient();

        // Handle --status separately (uses updateStatus API)
        if (options.status) {
          const valid = ['backlog', 'running', 'paused', 'completed', 'failed', 'canceled'];
          if (!valid.includes(options.status)) {
            log.error(`Invalid status "${options.status}". Must be one of: ${valid.join(', ')}`);
            return;
          }
          const result = await client.task.updateStatus.mutate({ id, status: options.status });
          log.info(`${pc.bold(result.data.identifier)} → ${options.status}`);
          return;
        }

        const input: Record<string, any> = { id };
        if (options.name) input.name = options.name;
        if (options.instruction) input.instruction = options.instruction;
        if (options.description) input.description = options.description;
        if (options.agent) input.assigneeAgentId = options.agent;
        if (options.priority) input.priority = Number.parseInt(options.priority, 10);
        if (options.heartbeatInterval)
          input.heartbeatInterval = Number.parseInt(options.heartbeatInterval, 10);
        if (options.heartbeatTimeout !== undefined) {
          const val = Number.parseInt(options.heartbeatTimeout, 10);
          input.heartbeatTimeout = val === 0 ? null : val;
        }

        const result = await client.task.update.mutate(input as any);

        if (options.json !== undefined) {
          outputJson(result.data, typeof options.json === 'string' ? options.json : undefined);
          return;
        }

        log.info(`Task updated: ${pc.bold(result.data.identifier)}`);
      },
    );

  // ── delete ──────────────────────────────────────────────

  task
    .command('delete <id>')
    .description('Delete a task')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const ok = await confirm(`Delete task ${pc.bold(id)}?`);
        if (!ok) return;
      }

      const client = await getTrpcClient();
      await client.task.delete.mutate({ id });
      log.info(`Task ${pc.bold(id)} deleted.`);
    });

  // ── clear ──────────────────────────────────────────────

  task
    .command('clear')
    .description('Delete all tasks')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options: { yes?: boolean }) => {
      if (!options.yes) {
        const ok = await confirm(`Delete ${pc.red('ALL')} tasks? This cannot be undone.`);
        if (!ok) return;
      }

      const client = await getTrpcClient();
      const result = (await client.task.clearAll.mutate()) as any;
      log.info(`${result.count} task(s) deleted.`);
    });

  // ── tree ──────────────────────────────────────────────

  task
    .command('tree <id>')
    .description('Show task tree (subtasks + dependencies)')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.task.getTaskTree.query({ id });

      if (options.json !== undefined) {
        outputJson(result.data, options.json);
        return;
      }

      if (!result.data || result.data.length === 0) {
        log.info('No tasks found.');
        return;
      }

      // Build tree display (raw SQL returns snake_case)
      const taskMap = new Map<string, any>();
      for (const t of result.data) taskMap.set(t.id, t);

      const printNode = (taskId: string, indent: number) => {
        const t = taskMap.get(taskId);
        if (!t) return;

        const prefix = indent === 0 ? '' : '  '.repeat(indent) + '├── ';
        const name = t.name || t.identifier || '';
        const status = t.status || 'pending';
        const identifier = t.identifier || t.id;
        console.log(`${prefix}${pc.dim(identifier)} ${statusBadge(status)} ${name}`);

        // Print children (handle both camelCase and snake_case)
        for (const child of result.data) {
          const childParent = child.parentTaskId || child.parent_task_id;
          if (childParent === taskId) {
            printNode(child.id, indent + 1);
          }
        }
      };

      // Find root - resolve identifier first
      const resolved = await client.task.find.query({ id });
      const rootId = resolved.data.id;
      const root = result.data.find((t: any) => t.id === rootId);
      if (root) printNode(root.id, 0);
      else log.info('Root task not found in tree.');
    });

  // Register subcommand groups
  registerLifecycleCommands(task);
  registerCheckpointCommands(task);
  registerReviewCommands(task);
  registerDepCommands(task);
  registerTopicCommands(task);
  registerDocCommands(task);
}
