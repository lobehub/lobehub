import { describe, expect, it } from 'vitest';

import { deriveGoalTitle } from './goalTitle';

describe('deriveGoalTitle', () => {
  it('uses the first semantic clause instead of the entire instruction', () => {
    expect(
      deriveGoalTitle(
        '搜集 YC26 的所有公司清单，整理成一个 xlsx。需要包含公司名称、批次、官网与公开来源。',
      ),
    ).toBe('搜集 YC26 的所有公司清单');
  });

  it('caps an unpunctuated title', () => {
    expect(deriveGoalTitle('a'.repeat(80))).toHaveLength(48);
  });
});
