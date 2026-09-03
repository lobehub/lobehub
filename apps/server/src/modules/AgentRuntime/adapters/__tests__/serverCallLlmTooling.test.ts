import type { AgentState } from '@lobechat/agent-runtime';
import { describe, expect, it } from 'vitest';

import { resolveServerCallLlmTooling } from '../serverCallLlmTooling';

const buildState = (metadata?: AgentState['metadata']): AgentState => ({ metadata }) as AgentState;

describe('resolveServerCallLlmTooling', () => {
  // Regression: `serverCallLlmContextBuilder` needs this to compute
  // `creds_sandbox_reachable` — `sandbox_enabled` alone (whether the
  // dedicated Cloud Sandbox tool is offered) doesn't tell it whether
  // `runCommand`/`execScript` will actually land in that sandbox or on a
  // routed device, so it must read the same single-track device gate the
  // rest of the run executors use.
  it('exposes the active device id when a device is routed for this run', () => {
    const result = resolveServerCallLlmTooling(
      { operationId: 'op-1', stepIndex: 0 },
      buildState({
        activeDeviceId: 'device-1',
        executionPlan: { deviceId: 'device-1', kind: 'device' },
      } as AgentState['metadata']),
    );

    expect(result.activeDeviceId).toBe('device-1');
  });

  it('leaves the active device id undefined when no device is routed', () => {
    const result = resolveServerCallLlmTooling(
      { operationId: 'op-1', stepIndex: 0 },
      buildState({ executionPlan: { kind: 'sandbox' } } as AgentState['metadata']),
    );

    expect(result.activeDeviceId).toBeUndefined();
  });

  it('leaves the active device id undefined with no metadata at all', () => {
    const result = resolveServerCallLlmTooling({ operationId: 'op-1', stepIndex: 0 }, buildState());

    expect(result.activeDeviceId).toBeUndefined();
  });
});
