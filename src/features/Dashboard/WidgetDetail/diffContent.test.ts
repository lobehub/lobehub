import { describe, expect, it } from 'vitest';

import { contractOf, DIFF_OPTIONS, withTrailingNewline } from './diffContent';

describe('diffContent', () => {
  it('expands unchanged lines so the untranslatable collapsed-lines label never renders', () => {
    expect(DIFF_OPTIONS).toMatchObject({ expandUnchanged: true });
  });

  it('diffs the contract without the script', () => {
    const contract = contractOf({
      manifest: { timeoutMs: 1000 },
      outputType: 'stat',
      runtime: 'node',
      script: 'console.log(1)',
      view: null,
    } as any);

    expect(JSON.parse(contract)).toEqual({
      manifest: { timeoutMs: 1000 },
      outputType: 'stat',
      runtime: 'node',
      view: null,
    });
  });

  it('ignores a missing trailing newline', () => {
    expect(withTrailingNewline('a')).toBe('a\n');
    expect(withTrailingNewline('a\n')).toBe('a\n');
    expect(withTrailingNewline('')).toBe('');
  });
});
