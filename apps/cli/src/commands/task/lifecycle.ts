import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { getAuthInfo } from '../../api/http';
import { streamAgentEvents } from '../../utils/agentStream';
import { log } from '../../utils/logger';

export function registerLifecycleCommands(task: Command) {
  // ── start ──────────────────────────────────────────────

  task
    .command('start <id>')
    .description('Start a task (pending → running)')
    .option('--no-run', 'Only update status, do not trigger agent execution')
    .option('-p, --prompt <text>', 'Additional context for the agent')
    .option('-f, --follow', 'Follow agent output in real-time (default: run in background)')
    .option('--json', 'Output full JSON event stream')
    .option('-v, --verbose', 'Show detailed tool call info')
    .action(
      async (
        id: string,
        options: {
          follow?: boolean;
          json?: boolean;
          prompt?: string;
          run?: boolean;
          verbose?: boolean;
        },
      ) => {
        const client = await getTrpcClient();

        // Check if already running
        const taskDetail = await client.task.find.query({ id });

        if (taskDetail.data.status === 'running') {
          log.info(`Task ${pc.bold(taskDetail.data.identifier)} is already running.`);
          return;
        }

        const statusResult = await client.task.updateStatus.mutate({ id, status: 'running' });
        log.info(`Task ${pc.bold(statusResult.data.identifier)} started.`);

        // Auto-run unless --no-run
        if (options.run === false) return;

        // Default agent to inbox if not assigned
        if (!taskDetail.data.assigneeAgentId) {
          await client.task.update.mutate({ assigneeAgentId: 'inbox', id });
          log.info(`Assigned default agent: ${pc.dim('inbox')}`);
        }

        const result = (await client.task.run.mutate({
          id,
          ...(options.prompt && { prompt: options.prompt }),
        })) as any;

        if (!result.success) {
          log.error(`Failed to run task: ${result.error || result.message || 'Unknown error'}`);
          process.exit(1);
        }

        log.info(
          `Operation: ${pc.dim(result.operationId)} · Topic: ${pc.dim(result.topicId || 'n/a')}`,
        );

        if (!options.follow) {
          log.info(
            `Agent running in background. Use ${pc.dim(`lh task view ${id}`)} to check status.`,
          );
          return;
        }

        const { serverUrl, headers } = await getAuthInfo();
        const streamUrl = `${serverUrl}/api/agent/stream?operationId=${encodeURIComponent(result.operationId)}`;

        await streamAgentEvents(streamUrl, headers, {
          json: options.json,
          verbose: options.verbose,
        });

        // Send heartbeat after completion
        try {
          await client.task.heartbeat.mutate({ id });
        } catch {
          // ignore heartbeat errors
        }
      },
    );

  // ── run ──────────────────────────────────────────────

  task
    .command('run <id>')
    .description('Run a task — trigger agent execution')
    .option('-p, --prompt <text>', 'Additional context for the agent')
    .option('-c, --continue <topicId>', 'Continue running on an existing topic')
    .option('-f, --follow', 'Follow agent output in real-time (default: run in background)')
    .option('--topics <n>', 'Run N topics in sequence (default: 1, implies --follow)', '1')
    .option('--delay <s>', 'Delay between topics in seconds', '0')
    .option('--json', 'Output full JSON event stream')
    .option('-v, --verbose', 'Show detailed tool call info')
    .action(
      async (
        id: string,
        options: {
          continue?: string;
          delay?: string;
          follow?: boolean;
          json?: boolean;
          prompt?: string;
          topics?: string;
          verbose?: boolean;
        },
      ) => {
        const topicCount = Number.parseInt(options.topics || '1', 10);
        const delaySec = Number.parseInt(options.delay || '0', 10);

        // --topics > 1 implies --follow
        const shouldFollow = options.follow || topicCount > 1;

        for (let i = 0; i < topicCount; i++) {
          if (i > 0) {
            log.info(`\n${'─'.repeat(60)}`);
            log.info(`Topic ${i + 1}/${topicCount}`);
            if (delaySec > 0) {
              log.info(`Waiting ${delaySec}s before next topic...`);
              await new Promise((r) => setTimeout(r, delaySec * 1000));
            }
          }

          const client = await getTrpcClient();

          // Auto-assign inbox agent on first topic if not assigned
          if (i === 0) {
            const taskDetail = await client.task.find.query({ id });
            if (!taskDetail.data.assigneeAgentId) {
              await client.task.update.mutate({ assigneeAgentId: 'inbox', id });
              log.info(`Assigned default agent: ${pc.dim('inbox')}`);
            }
          }

          // Only pass extra prompt and continue on first topic
          const result = (await client.task.run.mutate({
            id,
            ...(i === 0 && options.prompt && { prompt: options.prompt }),
            ...(i === 0 && options.continue && { continueTopicId: options.continue }),
          })) as any;

          if (!result.success) {
            log.error(`Failed to run task: ${result.error || result.message || 'Unknown error'}`);
            process.exit(1);
          }

          const operationId = result.operationId;
          if (i === 0) {
            log.info(`Task ${pc.bold(result.taskIdentifier)} running`);
          }
          log.info(`Operation: ${pc.dim(operationId)} · Topic: ${pc.dim(result.topicId || 'n/a')}`);

          if (!shouldFollow) {
            log.info(
              `Agent running in background. Use ${pc.dim(`lh task view ${id}`)} to check status.`,
            );
            return;
          }

          // Connect to SSE stream and wait for completion
          const { serverUrl, headers } = await getAuthInfo();
          const streamUrl = `${serverUrl}/api/agent/stream?operationId=${encodeURIComponent(operationId)}`;

          await streamAgentEvents(streamUrl, headers, {
            json: options.json,
            verbose: options.verbose,
          });

          // Update heartbeat after each topic
          try {
            await client.task.heartbeat.mutate({ id });
          } catch {
            // ignore heartbeat errors
          }
        }
      },
    );

  // ── comment ──────────────────────────────────────────────

  task
    .command('comment <id>')
    .description('Add a comment to a task')
    .requiredOption('-m, --message <text>', 'Comment content')
    .action(async (id: string, options: { message: string }) => {
      const client = await getTrpcClient();
      await client.task.addComment.mutate({ content: options.message, id });
      log.info('Comment added.');
    });

  // ── pause ──────────────────────────────────────────────

  task
    .command('pause <id>')
    .description('Pause a running task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = await client.task.updateStatus.mutate({ id, status: 'paused' });
      log.info(`Task ${pc.bold(result.data.identifier)} paused.`);
    });

  // ── resume ──────────────────────────────────────────────

  task
    .command('resume <id>')
    .description('Resume a paused task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = await client.task.updateStatus.mutate({ id, status: 'running' });
      log.info(`Task ${pc.bold(result.data.identifier)} resumed.`);
    });

  // ── complete ──────────────────────────────────────────────

  task
    .command('complete <id>')
    .description('Mark a task as completed')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = (await client.task.updateStatus.mutate({ id, status: 'completed' })) as any;
      log.info(`Task ${pc.bold(result.data.identifier)} completed.`);
      if (result.unlocked?.length > 0) {
        log.info(`Unlocked: ${result.unlocked.map((id: string) => pc.bold(id)).join(', ')}`);
      }
      if (result.paused?.length > 0) {
        log.info(
          `Paused (checkpoint): ${result.paused.map((id: string) => pc.yellow(id)).join(', ')}`,
        );
      }
      if (result.checkpointTriggered) {
        log.info(`${pc.yellow('Checkpoint triggered')} — parent task paused for review.`);
      }
      if (result.allSubtasksDone) {
        log.info(`All subtasks of parent task completed.`);
      }
    });

  // ── cancel ──────────────────────────────────────────────

  task
    .command('cancel <id>')
    .description('Cancel a task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = await client.task.updateStatus.mutate({ id, status: 'canceled' });
      log.info(`Task ${pc.bold(result.data.identifier)} canceled.`);
    });

  // ── sort ──────────────────────────────────────────────

  task
    .command('sort <id> <identifiers...>')
    .description('Reorder subtasks (e.g. lh task sort T-1 T-2 T-4 T-3)')
    .action(async (id: string, identifiers: string[]) => {
      const client = await getTrpcClient();
      const result = (await client.task.reorderSubtasks.mutate({
        id,
        order: identifiers,
      })) as any;

      log.info('Subtasks reordered:');
      for (const item of result.data) {
        console.log(`  ${pc.dim(`#${item.sortOrder}`)} ${item.identifier}`);
      }
    });

  // ── heartbeat ──────────────────────────────────────────────

  task
    .command('heartbeat <id>')
    .description('Manually send heartbeat for a running task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      await client.task.heartbeat.mutate({ id });
      log.info(`Heartbeat sent for ${pc.bold(id)}.`);
    });

  // ── watchdog ──────────────────────────────────────────────

  task
    .command('watchdog')
    .description('Run watchdog check — detect and fail stuck tasks')
    .action(async () => {
      const client = await getTrpcClient();
      const result = (await client.task.watchdog.mutate()) as any;

      if (result.failed?.length > 0) {
        log.info(
          `${pc.red('Stuck tasks failed:')} ${result.failed.map((id: string) => pc.bold(id)).join(', ')}`,
        );
      } else {
        log.info('No stuck tasks found.');
      }
    });
}
