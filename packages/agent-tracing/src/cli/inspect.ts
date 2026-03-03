import type { Command } from 'commander';

import { FileSnapshotStore } from '../store/file-store';
import { renderMessageDetail, renderSnapshot, renderStepDetail } from '../viewer';

export function registerInspectCommand(program: Command) {
  program
    .command('inspect')
    .description('Inspect trace details')
    .argument('<traceId>', 'Trace ID to inspect')
    .option('-s, --step <n>', 'View specific step')
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
    .option('-j, --json', 'Output as JSON')
    .action(
      async (
        traceId: string,
        opts: {
          context?: boolean;
          events?: boolean;
          json?: boolean;
          messages?: boolean;
          msg?: string;
          msgInput?: string;
          step?: string;
          tools?: boolean;
        },
      ) => {
        const store = new FileSnapshotStore();
        const snapshot = await store.get(traceId);
        if (!snapshot) {
          console.error(`Snapshot not found: ${traceId}`);
          process.exit(1);
        }

        const stepIndex = opts.step !== undefined ? Number.parseInt(opts.step, 10) : undefined;

        if (opts.json) {
          if (stepIndex !== undefined) {
            const step = snapshot.steps.find((s) => s.stepIndex === stepIndex);
            console.log(JSON.stringify(step ?? null, null, 2));
          } else {
            console.log(JSON.stringify(snapshot, null, 2));
          }
          return;
        }

        // --msg or --msg-input: show full message detail
        const msgIndex =
          opts.msg !== undefined
            ? Number.parseInt(opts.msg, 10)
            : opts.msgInput !== undefined
              ? Number.parseInt(opts.msgInput, 10)
              : undefined;
        const msgSource: 'input' | 'output' = opts.msgInput !== undefined ? 'input' : 'output';

        if (msgIndex !== undefined && stepIndex !== undefined) {
          const step = snapshot.steps.find((s) => s.stepIndex === stepIndex);
          if (!step) {
            console.error(
              `Step ${stepIndex} not found. Available: ${snapshot.steps.map((s) => s.stepIndex).join(', ')}`,
            );
            process.exit(1);
          }
          console.log(renderMessageDetail(step, msgIndex, msgSource));
          return;
        }

        if (stepIndex !== undefined) {
          const step = snapshot.steps.find((s) => s.stepIndex === stepIndex);
          if (!step) {
            console.error(
              `Step ${stepIndex} not found. Available: ${snapshot.steps.map((s) => s.stepIndex).join(', ')}`,
            );
            process.exit(1);
          }
          console.log(
            renderStepDetail(step, {
              context: opts.context,
              events: opts.events,
              messages: opts.messages,
              tools: opts.tools,
            }),
          );
          return;
        }

        console.log(renderSnapshot(snapshot));
      },
    );
}
