import { describe, expect, it } from 'vitest';

import { missingSeedDependencies, parseTaskFile } from './seedTasks';

describe('parseTaskFile', () => {
  it('reads titles, briefs and dependsOn', () => {
    expect(
      parseTaskFile(
        JSON.stringify([
          'Signal',
          { description: 'rules', dependsOn: [' Signal '], title: 'Policy' },
        ]),
      ),
    ).toEqual(['Signal', { dependsOn: ['Signal'], description: 'rules', title: 'Policy' }]);
  });

  it('rejects a dependsOn that is not a list of titles', () => {
    expect(() => parseTaskFile(JSON.stringify([{ dependsOn: 'Signal', title: 'Policy' }]))).toThrow(
      '--task-file entry 0: dependsOn must be an array of task titles',
    );
  });

  it('rejects an entry without a title', () => {
    expect(() => parseTaskFile(JSON.stringify([{ description: 'x' }]))).toThrow(
      '--task-file entry 0 needs a title',
    );
  });
});

describe('missingSeedDependencies', () => {
  const nodes = [
    { id: 'signal-id', title: 'Signal' },
    { id: 'policy-id', title: 'Policy' },
  ] as any;
  const seeds = ['Signal', { dependsOn: ['Signal'], title: 'Policy' }];

  it('is empty when the server drew every dependsOn', () => {
    const edges = [{ kind: 'depends_on', sourceNodeId: 'policy-id', targetNodeId: 'signal-id' }];

    expect(missingSeedDependencies({ edges, nodes } as any, seeds)).toEqual([]);
  });

  it('lists the dependencies a server that predates dependsOn dropped', () => {
    expect(missingSeedDependencies({ edges: [], nodes } as any, seeds)).toEqual([
      '"Policy" depends on "Signal"',
    ]);
  });
});
