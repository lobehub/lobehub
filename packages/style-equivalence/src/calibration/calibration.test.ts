import { describe, expect, it } from 'vitest';

import { calibrate } from './index';

const record = (key: string, category: 'difference' | 'equal' | 'needs-signoff') => ({
  category,
  key,
  plan: { file: key.split('|')[0] },
});

const adapter = (verdicts: Record<string, 'difference' | 'equal' | 'inconclusive'>) => ({
  fixturesFor: (files: string[]) =>
    files.flatMap((file) => (file === 'src/Group.tsx' ? [{ file, id: 'GroupFixture' }] : [])),
  run: async ({ fixtureId }: { fixtureId: string }) => ({
    detail: 'exit code',
    verdict: verdicts[fixtureId],
  }),
});

const run = {
  base: 'b',
  cases: [record('src/Group.tsx|Group#0', 'equal'), record('src/Other.tsx|Other#0', 'difference')],
  head: 'h',
  repo: '/repo',
  runDir: '/run',
};

describe('calibrate', () => {
  it('blocks when the real mount sees a difference the synthetic run called equal', async () => {
    expect(await calibrate(run, adapter({ GroupFixture: 'difference' }))).toEqual([
      {
        detail: 'exit code',
        file: 'src/Group.tsx',
        fixtureId: 'GroupFixture',
        fixture: 'difference',
        status: 'mismatch',
        synthetic: 'equal',
      },
    ]);
  });

  it('agrees when both say equal, and only reports an inconclusive real mount', async () => {
    const [agree] = await calibrate(run, adapter({ GroupFixture: 'equal' }));
    expect(agree.status).toBe('agree');
    const [unknown] = await calibrate(run, adapter({ GroupFixture: 'inconclusive' }));
    expect(unknown.status).toBe('inconclusive');
  });

  it('runs nothing without an adapter', async () => {
    expect(await calibrate(run, undefined)).toEqual([]);
  });
});
