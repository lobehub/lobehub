import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveLinkToggleState, useAgentShareSupported } from './useAgentShareSupported';

const testState = vi.hoisted(() => ({
  /** What `getShareStatus` resolves to for the non-publishable lookup. */
  shareStatus: null as { visibility: 'link' | 'private' } | null,
  enableAgentShare: undefined as boolean | undefined,
  enableBusinessFeatures: true,
  hasActiveWorkspace: false,
  isBuiltinAgent: false,
}));

vi.mock('swr', () => ({
  default: (key: unknown, fetcher: () => unknown) => ({
    data: key ? fetcher() : undefined,
  }),
}));

vi.mock('@/libs/swr/keys', () => ({
  shareKeys: { agentShareStatus: (agentId: string) => ['share:agentShareStatus', agentId] },
}));

vi.mock('@/services/agentShare', () => ({
  agentShareService: { getShareStatus: () => testState.shareStatus },
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
    testState.shareStatus = null;
  });

  it('is unsupported without an agentId', () => {
    const { result } = renderHook(() => useAgentShareSupported(undefined));

    expect(result.current).toEqual({ publishable: false, supported: false, visible: false });
  });

  it('is unsupported for a workspace agent, regardless of the flags', () => {
    testState.hasActiveWorkspace = true;

    const { result } = renderHook(() => useAgentShareSupported('agent-1'));

    expect(result.current).toEqual({ publishable: false, supported: false, visible: false });
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

    expect(result.current).toEqual({ publishable: false, supported: false, visible: false });
  });

  it('is supported but not publishable while the rollout flag is unresolved', () => {
    testState.enableAgentShare = undefined;

    const { result } = renderHook(() => useAgentShareSupported('agent-1'));

    expect(result.current).toEqual({ publishable: false, supported: true, visible: false });
  });

  // Outside the allowlist with nothing live: no entry at all — the tab, the
  // header action and the settings deep link all key off `visible`.
  it('hides the entry when the rollout flag is off and no share exists', () => {
    testState.enableAgentShare = false;

    const { result } = renderHook(() => useAgentShareSupported('agent-1'));

    expect(result.current).toEqual({ publishable: false, supported: true, visible: false });
  });

  it('hides the entry when the rollout flag is off and the share is already revoked', () => {
    testState.enableAgentShare = false;
    testState.shareStatus = { visibility: 'private' };

    const { result } = renderHook(() => useAgentShareSupported('agent-1'));

    expect(result.current).toEqual({ publishable: false, supported: true, visible: false });
  });

  // An owner rolled back out of the allowlist keeps the entry for a live share
  // so it stays revocable (the server keeps `disable` open for this case).
  it('keeps the entry for a live share when the rollout flag is off', () => {
    testState.enableAgentShare = false;
    testState.shareStatus = { visibility: 'link' };

    const { result } = renderHook(() => useAgentShareSupported('agent-1'));

    expect(result.current).toEqual({ publishable: false, supported: true, visible: true });
  });

  it('is publishable and visible when every gate passes', () => {
    testState.enableAgentShare = true;

    const { result } = renderHook(() => useAgentShareSupported('agent-1'));

    expect(result.current).toEqual({ publishable: true, supported: true, visible: true });
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
