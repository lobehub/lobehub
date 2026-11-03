import type { Command } from 'commander';

import { FileSnapshotStore } from '../store/file-store';

export function registerPartialCommand(program: Command) {
  const partial = program.command('partial').description('Manage in-progress (partial) snapshots');

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

      console.log(
        `\nUse ${`"agent-tracing inspect <id>"`.toString()} to inspect a partial with full flags.`,
      );
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
