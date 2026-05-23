import type { Command } from 'commander';

import { FileTracingStore } from '../store/file-store';
import type { TracingPayload } from '../types';
import { renderPayloadDetail } from '../viewer';

export function registerInspectCommand(program: Command) {
  program
    .command('inspect', { isDefault: true })
    .alias('i')
    .description('Inspect a tracing record by tracing_id prefix (defaults to latest)')
    .argument('[tracingId]', 'tracing_id or prefix; omit to inspect the latest record')
    .option('-j, --json', 'Output the raw JSON payload')
    .option('-f, --full', 'Show full system_prompt / input / output (no truncation)')
    .action(async (tracingId: string | undefined, opts: { full?: boolean; json?: boolean }) => {
      const store = new FileTracingStore();
      let record: TracingPayload | null;
      if (tracingId) {
        record = await store.findByTracingId(tracingId);
      } else {
        record = await store.getLatest();
      }

      if (!record) {
        console.error(
          tracingId
            ? `No tracing record matched id prefix: ${tracingId}`
            : 'No tracing records found. Run a generateObject call first (NODE_ENV=development).',
        );
        process.exit(1);
      }

      console.info(opts.json ? JSON.stringify(record, null, 2) : renderPayloadDetail(record, opts));
    });
}
