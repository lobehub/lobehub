import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Reporter, TestModule, Vitest } from 'vitest/node';

import { durationKey } from './shardByDuration';

/**
 * Writes how long each test file took, end to end in its worker (environment,
 * setup, import and tests), to `VITEST_DURATIONS_OUT`. Canary runs publish the
 * merged map so later shards can balance by it (see `shardByDuration.ts`).
 */
export default class DurationReporter implements Reporter {
  private root = process.cwd();

  onInit(vitest: Vitest) {
    this.root = vitest.config.root;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>) {
    const out = process.env.VITEST_DURATIONS_OUT;
    if (!out) return;
    const durations: Record<string, number> = {};
    for (const testModule of testModules) {
      const diagnostic = testModule.diagnostic();
      const total =
        diagnostic.environmentSetupDuration +
        diagnostic.prepareDuration +
        diagnostic.setupDuration +
        diagnostic.collectDuration +
        diagnostic.duration;
      if (Number.isFinite(total) && total > 0) {
        durations[durationKey(testModule.project.name, this.root, testModule.moduleId)] =
          Math.round(total);
      }
    }
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(durations)}\n`);
  }
}
