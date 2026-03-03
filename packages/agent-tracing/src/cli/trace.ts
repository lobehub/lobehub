import type { Command } from 'commander';

import { FileSnapshotStore } from '../store/file-store';
import { renderSnapshot } from '../viewer';

export function registerTraceCommand(program: Command) {
  program
    .command('trace')
    .description('View latest or specific trace')
    .argument('[traceId]', 'Trace ID to view (defaults to latest)')
    .action(async (traceId?: string) => {
      const store = new FileSnapshotStore();
      const snapshot = traceId ? await store.get(traceId) : await store.getLatest();
      if (!snapshot) {
        console.error(
          traceId
            ? `Snapshot not found: ${traceId}`
            : 'No snapshots found. Run an agent operation first.',
        );
        process.exit(1);
      }
      console.log(renderSnapshot(snapshot));
    });
}
