import { describe, expect, it } from 'vitest';

import { parseExpertiseDomainBrief } from './expertise';

describe('parseExpertiseDomainBrief', () => {
  it('keeps the practice boundary verbatim while deriving an editable short title', () => {
    const brief =
      '我想让它在行程规划上变强，为一次具体出行安排日程、交通与住宿。泛泛的旅行灵感不算。';

    expect(parseExpertiseDomainBrief(brief)).toEqual({
      domainFilter: brief,
      title: '行程规划',
    });
  });

  it('trims input and caps a long derived title', () => {
    const result = parseExpertiseDomainBrief(
      '  一个非常非常非常非常非常非常长的专业领域名称，闲聊不算  ',
    );

    expect(result.domainFilter).toBe('一个非常非常非常非常非常非常长的专业领域名称，闲聊不算');
    expect(result.title).toHaveLength(19);
    expect(result.title.endsWith('…')).toBe(true);
  });
});
