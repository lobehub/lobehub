import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveLinkToggleState, useAgentShareSupported } from './useAgentShareSupported';

const testState = vi.hoisted(() => ({
  enableAgentShare: undefined as boolean | undefined,
  enableBusinessFeatures: true,
  hasActiveWorkspace: false,
  isBuiltinAgent: false,
}));

vi.mock('@/business/client/hooks/useHasActiveWorkspace', () => ({
  useHasActiveWorkspace: () => testState.hasActiveWorkspace,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector(undefined),
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    isBuiltinAgent: () => () => testState.isBuiltinAgent,
  },
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: typeof testState) => unknown) => selector(testState),
}));

vi.mock('@/store/serverConfig/selectors', () => ({
  featureFlagsSelectors: (state: typeof testState) => ({
    enableAgentShare: state.enableAgentShare,
  }),
  serverConfigSelectors: {
    enableBusinessFeatures: (state: typeof testState) => state.enableBusinessFeatures,
  },
}));

describe('useAgentShareSupported', () => {
  beforeEach(() => {
    testState.enableAgentShare = undefined;
    testState.enableBusinessFeatures = true;
    testState.hasActiveWorkspace = false;
    testState.isBuiltinAgent = false;
  });

  it('is unsupported without an agentId', () => {
    const { result } = renderHook(() => useAgentShareSupported(undefined));

    expect(result.current).toEqual({ publishable: false, supported: false });
  });

  it('is unsupported for a workspace agent, regardless of the flags', () => {
    testState.hasActiveWorkspace = true;

    const { result } = renderHook(() => useAgentShareSupported('agent-1'));

    expect(result.current).toEqual({ publishable: false, supported: false });
  });

  it('is unsupported for a builtin agent', () => {
    testState.isBuiltinAgent = true;

    const { result } = renderHook(() => useAgentShareSupported('agent-1'));

    expect(result.current.supported).toBe(false);
  });

  // Structural: an OSS deployment has no Agent Share surface at all,
  // server-enforced by `ENABLE_BUSINESS_FEATURES` — unlike `enableAgentShare`
  // below, this must hide the whole surface, not just block publishing.
  it('is unsupported on a deployment without business features, even with the rollout flag on', () => {
    testState.enableBusinessFeatures = false;
    testState.enableAgentShare = true;

    const { result } = renderHook(() => useAgentShareSupported('agent-1'));

    expect(result.current).toEqual({ publishable: false, supported: false });
  });

  it('is supported but not publishable while the rollout flag is unresolved', () => {
    testState.enableAgentShare = undefined;

    const { result } = renderHook(() => useAgentShareSupported('agent-1'));

    expect(result.current).toEqual({ publishable: false, supported: true });
  });

  it('is supported but not publishable when the rollout flag is off', () => {
    testState.enableAgentShare = false;

    const { result } = renderHook(() => useAgentShareSupported('agent-1'));

    expect(result.current).toEqual({ publishable: false, supported: true });
  });

  it('is publishable when every gate passes', () => {
    testState.enableAgentShare = true;

    const { result } = renderHook(() => useAgentShareSupported('agent-1'));

    expect(result.current).toEqual({ publishable: true, supported: true });
  });
});

describe('resolveLinkToggleState', () => {
  it('allows publishing when the account has the capability', () => {
    expect(resolveLinkToggleState({ isShared: false, publishable: true })).toEqual({
      canPublish: true,
      disabled: false,
      offHintKey: 'share.settings.link.offHint',
    });
  });

  it('blocks publishing and explains why when the account may not publish', () => {
    expect(resolveLinkToggleState({ isShared: false, publishable: false })).toEqual({
      canPublish: false,
      disabled: true,
      offHintKey: 'share.settings.link.publishDisabled',
    });
  });

  // The regression this gate exists for: an owner rolled back out of the
  // rollout must still be able to revoke a share they already published, which
  // is why the server keeps `agentShare.disable` open while the flag is off.
  it('keeps an already published share togglable when publishing is blocked', () => {
    const state = resolveLinkToggleState({ isShared: true, publishable: false });

    expect(state.disabled).toBe(false);
    expect(state.canPublish).toBe(true);
  });
});
