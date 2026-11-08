import type { CaseCategory } from '../verdict/categorize';

export type CalibrationVerdict = 'difference' | 'equal' | 'inconclusive';

export interface CalibrationAdapter {
  fixturesFor: (files: string[]) => Array<{ file: string; id: string }>;
  run: (input: {
    base: string;
    fixtureId: string;
    head: string;
    repo: string;
    runDir: string;
  }) => Promise<{ detail: string; verdict: CalibrationVerdict }>;
}

export interface CalibrationResult {
  detail: string;
  file: string;
  fixture: CalibrationVerdict;
  fixtureId: string;
  status: 'agree' | 'inconclusive' | 'mismatch';
  synthetic: 'difference' | 'equal';
}

export interface CalibrationRun {
  base: string;
  cases: Array<{ category: CaseCategory; key: string; plan: { file: string } }>;
  head: string;
  repo: string;
  runDir: string;
}

export const calibrate = async (
  run: CalibrationRun,
  adapter: CalibrationAdapter | undefined,
): Promise<CalibrationResult[]> => {
  if (!adapter) return [];
  const files = [...new Set(run.cases.map((entry) => entry.plan.file))];
  const results: CalibrationResult[] = [];
  for (const { file, id } of adapter.fixturesFor(files)) {
    const synthetic = run.cases.some(
      (entry) => entry.plan.file === file && entry.category === 'difference',
    )
      ? 'difference'
      : 'equal';
    const { detail, verdict } = await adapter.run({
      base: run.base,
      fixtureId: id,
      head: run.head,
      repo: run.repo,
      runDir: run.runDir,
    });
    results.push({
      detail,
      file,
      fixture: verdict,
      fixtureId: id,
      status:
        verdict === 'inconclusive' ? 'inconclusive' : verdict === synthetic ? 'agree' : 'mismatch',
      synthetic,
    });
  }
  return results;
};
