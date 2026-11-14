import { RequestTrigger } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { type DeferInitInput, shouldDeferOperationInit } from '../deferInitGate';

describe('shouldDeferOperationInit', () => {
  const plainSend: DeferInitInput = {
    autoStart: true,
    hasOrchestration: false,
    queueRuntimeEnabled: true,
    request: { runAttachments: {} } as DeferInitInput['request'],
    trigger: RequestTrigger.Chat,
  };

  const flagOn = async () => true;

  it('defers a plain chat send once the flag is on', async () => {
    await expect(shouldDeferOperationInit(plainSend, flagOn)).resolves.toBe(true);
  });

  it('keeps the init synchronous while the flag is off', async () => {
    await expect(shouldDeferOperationInit(plainSend, async () => false)).resolves.toBe(false);
  });

  it('does not read the flag for a run that could never defer', async () => {
    const isEnabled = vi.fn(flagOn);
    await expect(
      shouldDeferOperationInit({ ...plainSend, autoStart: false }, isEnabled),
    ).resolves.toBe(false);
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<DeferInitInput>]>([
    ['no queue runtime', { queueRuntimeEnabled: false }],
    ['an orchestrated run', { hasOrchestration: true }],
    ['a non-chat trigger', { trigger: 'cron' }],
  ])('keeps the init synchronous for %s', async (_, override) => {
    await expect(shouldDeferOperationInit({ ...plainSend, ...override }, flagOn)).resolves.toBe(
      false,
    );
  });

  it.each([
    ['a resume', { resume: true }],
    ['an approval', { resumeApproval: {} }],
    ['a batch approval', { resumeApprovals: [{}] }],
    ['a run from history', { resumeFromHistory: true }],
    ['a tool result', { resumeToolResult: {} }],
    ['a fixed device', { isFixedDeviceTarget: true }],
    ['a required device', { requireDevice: true }],
  ])('keeps the init synchronous for %s', async (_, request) => {
    await expect(
      shouldDeferOperationInit(
        {
          ...plainSend,
          request: { ...plainSend.request, ...request } as DeferInitInput['request'],
        },
        flagOn,
      ),
    ).resolves.toBe(false);
  });
});
