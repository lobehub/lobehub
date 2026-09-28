import { describe, expect, it } from 'vitest';

import { scanOperationFileEdits } from './index';

const codexRecord = (diffText: string) => [
  {
    apiName: 'file_change',
    arguments: '{}',
    identifier: 'codex',
    state: { changes: [{ diffText, kind: 'modified', path: '/repo/main/index.ts' }] },
    toolCallId: 'tc-1',
  },
];

describe('codex file_change line deltas', () => {
  it('counts them from the patch when the change entry carries no counts', () => {
    const patch = [
      '--- a/main/index.ts',
      '+++ b/main/index.ts',
      '@@ -1,3 +1,4 @@',
      ' keep',
      '-old line',
      '+new line',
      '+another new line',
    ].join('\n');

    const [entry] = scanOperationFileEdits(codexRecord(patch));

    expect(entry.linesAdded).toBe(2);
    expect(entry.linesDeleted).toBe(1);
  });

  it('keeps counts the source already provided', () => {
    const records = codexRecord('+++ b/x\n+a');
    (records[0].state.changes[0] as any).linesAdded = 9;
    (records[0].state.changes[0] as any).linesDeleted = 4;

    const [entry] = scanOperationFileEdits(records);

    expect(entry.linesAdded).toBe(9);
    expect(entry.linesDeleted).toBe(4);
  });
});
