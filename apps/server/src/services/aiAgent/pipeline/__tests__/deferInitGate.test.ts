import { RequestTrigger } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  type DeferInitInput,
  isDeferredInitRolledOut,
  shouldDeferOperationInit,
} from '../deferInitGate';

describe('isDeferredInitRolledOut', () => {
  it.each([undefined, '', '  '])('is off when the setting is %j', (setting) => {
    expect(isDeferredInitRolledOut(setting, 'user-1')).toBe(false);
  });

  it('covers everyone with *', () => {
    expect(isDeferredInitRolledOut('*', 'user-1')).toBe(true);
  });

  it('matches whole ids in a comma-separated list', () => {
    expect(isDeferredInitRolledOut('user-2, user-1', 'user-1')).toBe(true);
    expect(isDeferredInitRolledOut('user-10', 'user-1')).toBe(false);
  });
});

describe('shouldDeferOperationInit', () => {
  const plainSend: DeferInitInput = {
    autoStart: true,
    hasOrchestration: false,
    queueRuntimeEnabled: true,
    request: { runAttachments: {} } as DeferInitInput['request'],
    rolledOut: true,
    trigger: RequestTrigger.Chat,
  };

  it('defers a plain chat send', () => {
    expect(shouldDeferOperationInit(plainSend)).toBe(true);
  });

  it.each<[string, Partial<DeferInitInput>]>([
    ['outside the rollout', { rolledOut: false }],
    ['no queue runtime', { queueRuntimeEnabled: false }],
    ['no auto-start', { autoStart: false }],
    ['an orchestrated run', { hasOrchestration: true }],
    ['a non-chat trigger', { trigger: 'cron' }],
  ])('keeps the init synchronous for %s', (_, override) => {
    expect(shouldDeferOperationInit({ ...plainSend, ...override })).toBe(false);
  });

  it.each([
    ['a resume', { resume: true }],
    ['an approval', { resumeApproval: {} }],
    ['a batch approval', { resumeApprovals: [{}] }],
    ['a run from history', { resumeFromHistory: true }],
    ['a tool result', { resumeToolResult: {} }],
    ['a fixed device', { isFixedDeviceTarget: true }],
    ['a required device', { requireDevice: true }],
  ])('keeps the init synchronous for %s', (_, request) => {
    expect(
      shouldDeferOperationInit({
        ...plainSend,
        request: { ...plainSend.request, ...request } as DeferInitInput['request'],
      }),
    ).toBe(false);
  });
});
