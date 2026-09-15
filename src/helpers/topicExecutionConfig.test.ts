import { applyTopicExecutionConfig, snapshotTopicExecutionConfig } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { resolveExecutionTarget } from './executionTarget';
import { resolveTopicAgencyConfig } from './topicExecutionConfig';

describe('Topic execution isolation', () => {
  it('keeps A on its device when B or the Agent default switches to sandbox', () => {
    const defaults = { executionTarget: 'local' as const, boundDeviceId: 'device-a' };
    const topicA = snapshotTopicExecutionConfig(defaults);
    const changedDefaults = { executionTarget: 'sandbox' as const, boundDeviceId: 'device-b' };
    expect(applyTopicExecutionConfig(changedDefaults, topicA)).toMatchObject(defaults);
    expect(applyTopicExecutionConfig(defaults, { executionTarget: 'sandbox' })).toMatchObject({
      executionTarget: 'sandbox',
      boundDeviceId: undefined,
    });
    expect(defaults.boundDeviceId).toBe('device-a');
  });
  it('does not inherit stale device or sandbox flags into an explicit Topic selection', () => {
    expect(
      applyTopicExecutionConfig(
        { boundDeviceId: 'a', localSandbox: true },
        {
          executionTarget: 'auto',
        },
      ),
    ).toEqual({
      executionTarget: 'auto',
      boundDeviceId: undefined,
      localSandbox: undefined,
      localSandboxNetwork: undefined,
    });
  });
  it('keeps fixed policy authoritative and preserves legacy defaults', () => {
    const fixed = {
      executionTarget: 'device' as const,
      boundDeviceId: 'fixed',
      executionTargetSelectionPolicy: 'fixed' as const,
    };
    expect(applyTopicExecutionConfig(fixed, { executionTarget: 'sandbox' })).toBe(fixed);
    expect(applyTopicExecutionConfig(fixed, undefined)).toBe(fixed);
  });
});

vi.mock('@/store/chat', () => ({ useChatStore: { getState: () => ({}) } }));

it('uses Topic scope for a workspace member without an Agent override', () => {
  const selection = resolveTopicAgencyConfig(
    { executionTarget: 'sandbox' },
    {
      executionTarget: 'local',
      boundDeviceId: 'this-machine',
    },
    true,
  );
  expect(selection.workspaceScoped).toBe(false);
  expect(selection.agencyConfig).toMatchObject({
    executionTarget: 'local',
    boundDeviceId: 'this-machine',
  });
});

it.each([undefined, 'local'] as const)(
  'keeps an inherited %s workspace target from becoming local execution',
  (executionTarget) => {
    const defaults = { executionTarget };
    const selection = resolveTopicAgencyConfig(
      defaults,
      snapshotTopicExecutionConfig(defaults),
      true,
    );
    expect(selection.workspaceScoped).toBe(true);
    expect(
      resolveExecutionTarget(selection.agencyConfig, {
        clientExecutionAvailable: true,
        isHetero: true,
        workspaceScoped: selection.workspaceScoped,
      }),
    ).toBe('sandbox');
  },
);
