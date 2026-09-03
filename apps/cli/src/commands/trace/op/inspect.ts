import { InspectError, type InspectOptions, inspectSnapshot } from '@lobechat/agent-tracing';
import type { Command } from 'commander';

import { log } from '../../../utils/logger';
import { resolveSnapshotOrExit } from './snapshot';

export function registerOpInspectCommand(parent: Command) {
  parent
    .command('inspect')
    .alias('i')
    .description('Inspect a recorded operation: steps, messages, tools, context engine input')
    .argument('[target]', 'Operation id, trace id, snapshot json path, URL, or "latest"')
    .option('-s, --step <n>', 'View specific step (default: 0 for -r/--env)')
    .option('-m, --messages', 'Show messages context')
    .option('-t, --tools', 'Show tool call details')
    .option('-e, --events', 'Show raw events (llm_start, llm_result, etc.)')
    .option('-c, --context', 'Show runtime context & payload')
    .option('--msg <n>', 'Show full content of message [N] from Final LLM Payload')
    .option('--msg-input <n>', 'Show full content of message [N] from Context Engine Input')
    .option('-r, --system-role', 'Show full system role content (default step 0)')
    .option('--env', 'Show environment context (default step 0)')
    .option('-d, --diff <n>', 'Diff against step N (use with -r or --env)')
    .option('-T, --payload-tools', 'List available tools registered in LLM payload')
    .option('-M, --memory', 'Show full user memory content (default step 0)')
    .option('-S, --agent-signal', 'Show local agent-signal chain analysis')
    .option('-p, --payload', 'Show context engine input overview')
    .option('-j, --json', 'Output as JSON')
    .action(async (target: string | undefined, opts: InspectOptions) => {
      const snapshot = await resolveSnapshotOrExit(target);

      try {
        console.log(inspectSnapshot(snapshot, opts));
      } catch (error) {
        if (error instanceof InspectError) {
          log.error(error.message);
          process.exit(1);
        }
        throw error;
      }
    });
}
