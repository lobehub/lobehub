import { describe, expect, it } from 'vitest';

import { classifyCliQuotaMessage } from './cliQuota';

// The exact stderr Kimi Code exits with when the subscription window closes.
const KIMI_WEEKLY_LIMIT = [
  "error: failed to run prompt: provider.auth_error: 403 You've reached your weekly (7-day) usage",
  'limit. Your quota will reset when the current 7-day window ends. To continue now, purchase extra',
  'usage or upgrade your plan: https://www.kimi.com/membership/subscription?tab=quota',
  'See log: /Users/user/.kimi-code/logs/kimi-code.log',
].join(' ');

describe('classifyCliQuotaMessage', () => {
  it('reads a Kimi Code weekly window as a resetting plan limit', () => {
    expect(classifyCliQuotaMessage(KIMI_WEEKLY_LIMIT)).toEqual({
      kind: 'usage_limit',
      rateLimitType: 'seven_day',
    });
  });

  it('keeps a credit limit distinct from a window that resets', () => {
    expect(
      classifyCliQuotaMessage(
        "You've reached your Fable 5 limit. Run /usage-credits to continue or switch models.",
      ),
    ).toEqual({ kind: 'credit_limit' });
  });

  it('names the window CC reports in prose', () => {
    expect(
      classifyCliQuotaMessage("You've hit your session limit · resets 6:30pm (Asia/Shanghai)"),
    ).toEqual({ kind: 'usage_limit', rateLimitType: 'five_hour' });
    expect(classifyCliQuotaMessage("You've hit your weekly limit · resets Jul 3 at 1pm")).toEqual({
      kind: 'usage_limit',
      rateLimitType: 'seven_day',
    });
  });

  it('classifies a localized gateway rejection', () => {
    expect(
      classifyCliQuotaMessage(
        'API Error: Request rejected (429) · [1234][已达到 5 小时使用上限，2026-06-19 22:00:00 后可继续使用。]',
      ),
    ).toEqual({ kind: 'usage_limit', rateLimitType: 'five_hour' });
  });

  it('leaves transient throttling and bare rate limits to the retry path', () => {
    expect(
      classifyCliQuotaMessage(
        'API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited',
      ),
    ).toBeUndefined();
    expect(classifyCliQuotaMessage('429 Too Many Requests')).toBeUndefined();
    expect(classifyCliQuotaMessage('rate limited')).toBeUndefined();
    expect(classifyCliQuotaMessage(undefined)).toBeUndefined();
  });
});
