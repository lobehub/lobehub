import { describe, expect, it } from 'vitest';

import { buildCodeContextSelection } from './selection';

const patch = `@@ -8,5 +8,6 @@
 keep before
-old line
+new line
+another new line
 keep after`;

describe('buildCodeContextSelection', () => {
  it('builds a code context selection from selected additions', () => {
    const selection = buildCodeContextSelection({
      filePath: 'src/example.ts',
      language: 'ts',
      patch,
      range: { end: 10, side: 'additions', start: 9 },
      workingDirectory: '/repo',
    });

    expect(selection).toEqual({
      content: 'new line\nanother new line',
      filePath: 'src/example.ts',
      language: 'ts',
      lineRange: { endLine: 10, startLine: 9 },
      preview: 'src/example.ts:9-10',
      side: 'additions',
      source: 'code',
      title: 'src/example.ts:9-10',
      workingDirectory: '/repo',
    });
  });

  it('builds a code context selection from selected deletions', () => {
    const selection = buildCodeContextSelection({
      filePath: 'src/example.ts',
      patch,
      range: { end: 9, side: 'deletions', start: 9 },
      workingDirectory: '/repo',
    });

    expect(selection).toMatchObject({
      content: 'old line',
      lineRange: { endLine: 9, startLine: 9 },
      side: 'deletions',
      source: 'code',
    });
  });

  it('preserves context lines when selected from either side', () => {
    const selection = buildCodeContextSelection({
      filePath: 'src/example.ts',
      patch,
      range: { end: 11, side: 'additions', start: 11 },
      workingDirectory: '/repo',
    });

    expect(selection).toMatchObject({
      content: 'keep after',
      lineRange: { endLine: 11, startLine: 11 },
      side: 'context',
      source: 'code',
    });
  });
});
