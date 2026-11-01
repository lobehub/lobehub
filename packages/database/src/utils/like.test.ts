import { describe, expect, it } from 'vitest';

import { escapeLike } from './like';

describe('escapeLike', () => {
  it('escapes LIKE metacharacters so they match literally', () => {
    expect(escapeLike('100%_done\\')).toBe('100\\%\\_done\\\\');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLike('搜索 hooks')).toBe('搜索 hooks');
  });
});
