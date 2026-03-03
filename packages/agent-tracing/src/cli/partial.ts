import type { Command } from 'commander';

import { FileSnapshotStore } from '../store/file-store';
import type { ExecutionSnapshot } from '../types';
import { renderSnapshot } from '../viewer';

export function registerPartialCommand(program: Command) {
  const partial = program.command('partial').description('Inspect in-progress (partial) snapshots');

  partial
    .command('list')
    .alias('ls')
    .description('List partial snapshots')
    .action(async () => {
      const store = new FileSnapshotStore();
      const files = await store.listPartials();

      if (files.length === 0) {
        console.log('No partial snapshots found.');
        return;
      }

      console.log(`${files.length} partial snapshot(s):\n`);
      for (const file of files) {
        const partial = await store.getPartial(file);
        if (partial) {
          const steps = partial.steps?.length ?? 0;
          const model = partial.model ?? '-';
          const opId = partial.operationId ?? file.replace('.json', '');
          const elapsed = partial.startedAt
            ? `${((Date.now() - partial.startedAt) / 1000).toFixed(0)}s ago`
            : '-';
          console.log(`  ${opId}`);
          console.log(`    model=${model}  steps=${steps}  started=${elapsed}`);
        } else {
          console.log(`  ${file}`);
        }
      }
    });

  partial
    .command('inspect')
    .alias('view')
    .description('Inspect a partial snapshot')
    .argument('[id]', 'Partial operation ID or filename (defaults to latest)')
    .option('-j, --json', 'Output as JSON')
    .action(async (id: string | undefined, opts: { json?: boolean }) => {
      const store = new FileSnapshotStore();
      const files = await store.listPartials();

      if (files.length === 0) {
        console.error('No partial snapshots found.');
        process.exit(1);
      }

      const data = id ? await store.getPartial(id) : await store.getPartial(files[0]);

      if (!data) {
        console.error(id ? `Partial not found: ${id}` : 'No partial snapshots found.');
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // Render as a snapshot (fill in defaults for missing fields)
      const snapshot: ExecutionSnapshot = {
        completedAt: undefined,
        completionReason: undefined,
        error: undefined,
        model: data.model,
        operationId: data.operationId ?? '?',
        provider: data.provider,
        startedAt: data.startedAt ?? Date.now(),
        steps: data.steps ?? [],
        totalCost: data.totalCost ?? 0,
        totalSteps: data.steps?.length ?? 0,
        totalTokens: data.totalTokens ?? 0,
        traceId: data.traceId ?? '?',
        ...data,
      };

      console.log('[PARTIAL - in progress]\n');
      console.log(renderSnapshot(snapshot));
    });

  partial
    .command('clean')
    .description('Remove all partial snapshots')
    .action(async () => {
      const store = new FileSnapshotStore();
      const files = await store.listPartials();

      if (files.length === 0) {
        console.log('No partial snapshots to clean.');
        return;
      }

      for (const file of files) {
        const opId = file.replace('.json', '');
        await store.removePartial(opId);
      }
      console.log(`Removed ${files.length} partial snapshot(s).`);
    });
}
