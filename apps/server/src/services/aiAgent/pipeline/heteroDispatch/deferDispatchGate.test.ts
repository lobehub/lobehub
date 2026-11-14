import { RequestTrigger } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { shouldDeferHeteroDispatch } from './deferDispatchGate';

describe('shouldDeferHeteroDispatch', () => {
  const plainSend = { hasOrchestration: false, trigger: RequestTrigger.Chat };
  const flagOn = async () => true;

  it('defers a plain chat send once the flag is on', async () => {
    await expect(shouldDeferHeteroDispatch(plainSend, flagOn)).resolves.toBe(true);
  });

  it('keeps the dispatch synchronous while the flag is off', async () => {
    await expect(shouldDeferHeteroDispatch(plainSend, async () => false)).resolves.toBe(false);
  });

  it('keeps the dispatch synchronous when the flag cannot be read', async () => {
    await expect(
      shouldDeferHeteroDispatch(plainSend, () => Promise.reject(new Error('config down'))),
    ).resolves.toBe(false);
  });

  it.each([
    ['an orchestrated run', { hasOrchestration: true }],
    ['a bot message', { trigger: 'bot' }],
    ['a scheduled run', { trigger: RequestTrigger.Scheduled }],
    ['a run without a trigger', { trigger: undefined }],
  ])('does not read the flag for %s', async (_, override) => {
    const isEnabled = vi.fn(flagOn);

    await expect(shouldDeferHeteroDispatch({ ...plainSend, ...override }, isEnabled)).resolves.toBe(
      false,
    );
    expect(isEnabled).not.toHaveBeenCalled();
  });
});
