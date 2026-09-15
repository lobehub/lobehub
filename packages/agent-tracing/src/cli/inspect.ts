import type { Command } from 'commander';

import { InspectError, type InspectOptions, inspectSnapshot } from '../inspect/inspectSnapshot';
import { loadSnapshot } from '../store/loadSnapshot';

export function registerInspectCommand(program: Command) {
  program
    .command('inspect', { isDefault: true })
    .alias('i')
    .description('Inspect trace details')
    .argument('[traceId]', 'Trace ID to inspect (defaults to latest)')
    .option('-s, --step <n>', 'View specific step (default: 0 for -r/--env)')
    .option('-m, --messages', 'Show messages context')
    .option('-t, --tools', 'Show tool call details')
    .option('-e, --events', 'Show raw events (llm_start, llm_result, etc.)')
    .option('-c, --context', 'Show runtime context & payload')
    .option(
      '--msg <n>',
      'Show full content of message [N] from Final LLM Payload (use with --step)',
    )
    .option(
      '--msg-input <n>',
      'Show full content of message [N] from Context Engine Input (use with --step)',
    )
    .option('-r, --system-role', 'Show full system role content (default step 0)')
    .option('--env', 'Show environment context (default step 0)')
    .option('-d, --diff <n>', 'Diff against step N (use with -r or --env)')
    .option('-T, --payload-tools', 'List available tools registered in LLM payload')
    .option('-M, --memory', 'Show full user memory content (default step 0)')
    .option('-S, --agent-signal', 'Show local agent-signal chain analysis')
    .option(
      '-p, --payload',
      'Show context engine input overview (knowledge, memory, capabilities, etc.)',
    )
    .option('-j, --json', 'Output as JSON')
    .action(async (traceId: string | undefined, opts: InspectOptions) => {
      let snapshot;
      try {
        snapshot = await loadSnapshot(traceId, { allowDownload: true });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }

      if (!snapshot) {
        console.error(
          traceId
            ? `Snapshot not found: ${traceId}`
            : 'No snapshots found. Run an agent operation first.',
        );
        process.exit(1);
      }

      try {
        console.log(inspectSnapshot(snapshot, opts));
      } catch (error) {
        if (error instanceof InspectError) {
          console.error(error.message);
          process.exit(1);
        }
        throw error;
      }
    });
}
