import { spawn } from 'node:child_process';
import path from 'node:path';

import type {
  CalibrationAdapter,
  CalibrationVerdict,
} from '../../packages/style-equivalence/src/calibration';
import { resolveBrowserExecutable } from '../../packages/style-equivalence/src/capture/browser';
import { fixtureIds, getStyleFixture } from './verification/fixtures/fixtureRegistry';

const VERDICTS: Record<string, CalibrationVerdict> = {
  DIFFERENT: 'difference',
  EQUAL_IN_SAMPLES: 'equal',
};

const componentStatus = (output: string) => {
  for (const line of output.trim().split('\n').reverse()) {
    if (!line.startsWith('{') || !line.includes('"component"')) continue;
    try {
      return (JSON.parse(line) as { component?: { sampledStyleStatus?: string } }).component
        ?.sampledStyleStatus;
    } catch {
      continue;
    }
  }
  return undefined;
};

export const fixtureCalibration: CalibrationAdapter = {
  fixturesFor: (files) =>
    fixtureIds.flatMap((id) => {
      const file = getStyleFixture(id).component.candidate.source;
      return files.includes(file) ? [{ file, id }] : [];
    }),
  run: ({ base, fixtureId, head, repo, runDir }) =>
    new Promise((resolve) => {
      const browser = resolveBrowserExecutable();
      const child = spawn(
        'bun',
        [
          path.join(repo, 'scripts/stylexMigration/verification/run.ts'),
          '--base',
          base,
          '--head',
          head,
          '--restore-dependencies',
          '--dependency-network',
          '--fixture',
          fixtureId,
          '--fixture-dependencies',
          '--output',
          path.join(runDir, 'calibration'),
          ...(browser ? ['--browser', browser] : []),
        ],
        { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let output = '';
      child.stdout.on('data', (chunk) => (output += chunk));
      child.stderr.on('data', (chunk) => (output += chunk));
      child.on('error', (error) => resolve({ detail: error.message, verdict: 'inconclusive' }));
      child.on('exit', (code) => {
        const status = componentStatus(output);
        const evidence = output.match(/^Evidence: (.+)$/m)?.[1];
        resolve({
          detail: `exit ${code ?? 'signal'} · ${status ?? 'no component result'}${evidence ? ` · ${evidence}` : ''}`,
          verdict: (status && VERDICTS[status]) || 'inconclusive',
        });
      });
    }),
};
