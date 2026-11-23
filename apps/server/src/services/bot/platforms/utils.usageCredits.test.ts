import type * as BusinessConst from '@lobechat/business-const';
import { expect, it, vi } from 'vitest';

import { appendUsageStats, formatUsageStats } from './utils';

vi.mock('@lobechat/business-const', async (load) => ({
  ...(await load<typeof BusinessConst>()),
  USAGE_CREDITS: { creditsPerUsd: 100, inputCreditsAt1x: 100 },
}));

it.each([
  ['zh-CN', '3.1 积分'],
  ['en-US', '3.1 Credits'],
] as const)(
  'keeps the localized charge without token counts or dollars in %s',
  (replyLocale, expected) => {
    expect(formatUsageStats({ replyLocale, totalCost: 0.0312, totalTokens: 543 })).toBe(expected);
  },
);

it('omits an empty footer, including Discord markdown', () => {
  expect(appendUsageStats('body', { totalCost: 0, totalTokens: 543 }, '-# ')).toBe('body');
});
