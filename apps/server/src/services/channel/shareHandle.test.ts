import { describe, expect, it } from 'vitest';

import { parseShareHandle } from './shareHandle';

describe('parseShareHandle', () => {
  it('accepts handles, @handles and share links', () => {
    expect(parseShareHandle('bob')).toBe('bob');
    expect(parseShareHandle(' @bob ')).toBe('bob');
    expect(parseShareHandle('https://app.lobehub.com/a/bob-helper/chat?x=1')).toBe('bob-helper');
    expect(parseShareHandle('  ')).toBeUndefined();
  });
});
