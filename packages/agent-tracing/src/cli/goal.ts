import type { Command } from 'commander';

import { FileGoalTraceStore } from '../goal/store/file-store';
import { renderGoalAdvanceDetail, renderGoalTrajectory } from '../goal/viewer';

export function registerGoalCommand(program: Command) {
  program
    .command('goal [goalId]')
    .description('Inspect a goal trajectory: its advances, and the decision behind each tick')
    .option('-a, --advance <n>', 'Show one advance in full, with its frontier candidates')
    .option('-l, --limit <n>', 'Max goals to list when no id is given', '10')
    .option('-j, --json', 'Output as JSON')
    .action(async (goalId: string | undefined, opts) => {
      const store = new FileGoalTraceStore();

      if (!goalId) {
        const summaries = await store.list({ limit: Number.parseInt(opts.limit, 10) || 10 });
        if (opts.json) return console.log(JSON.stringify(summaries, null, 2));
        if (summaries.length === 0) return console.log('No goal trajectories in .goal-tracing/');
        for (const summary of summaries) {
          console.log(
            `${summary.goalId}  ${String(summary.advances).padStart(4)} advances  ${summary.completionReason ?? 'in flight'}  ${summary.title}`,
          );
        }
        return;
      }

      const trajectory = await store.get(goalId);
      if (!trajectory) {
        console.error(
          `No trajectory for ${goalId}. Looked in .goal-tracing/ (run from repo root).`,
        );
        process.exitCode = 1;
        return;
      }

      if (opts.json) return console.log(JSON.stringify(trajectory, null, 2));

      if (opts.advance !== undefined) {
        const seq = Number.parseInt(opts.advance, 10);
        if (Number.isNaN(seq)) {
          console.error(`--advance expects a number, got "${opts.advance}"`);
          process.exitCode = 1;
          return;
        }
        return console.log(renderGoalAdvanceDetail(trajectory, seq));
      }

      console.log(renderGoalTrajectory(trajectory));
    });
}
