/**
 * @vitest-environment happy-dom
 */
import type * as LobechatConstModule from '@lobechat/const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';

import { resolveWorkspaceSurface, useWorkspaceSurface } from '../useWorkspaceSurface';

// The EFFECTIVE config (shared row + this member's per-user device override),
// as `useEffectiveAgencyConfig` would resolve it. The raw shared row lives in
// the real agent store so store-derived selectors see what they see in prod.
const effective = vi.hoisted(() => ({
  agencyConfig: undefined as LobeAgentAgencyConfig | undefined,
  workspaceScoped: false,
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobechatConstModule>()),
  isDesktop: true,
}));

vi.mock('@/helpers/gatewayMode', () => ({
  resolveGatewayModeEnabled: () => true,
  useIsGatewayModeEnabled: () => true,
}));

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: effective.agencyConfig,
    workspaceScoped: effective.workspaceScoped,
  }),
}));

const AGENT_ID = 'agent-1';

const setSharedAgent = (agent: { agencyConfig?: LobeAgentAgencyConfig; workspaceId?: string }) => {
  useAgentStore.setState({
    agentMap: { [AGENT_ID]: { id: AGENT_ID, visibility: 'public', ...agent } },
  });
};

beforeEach(() => {
  effective.agencyConfig = undefined;
  effective.workspaceScoped = false;
  useAgentStore.setState({ agentMap: {} });
});

describe('useWorkspaceSurface (desktop)', () => {
  // Regression for LOBE-13771: a workspace member's "Local device" pick lives in
  // their per-user override, never in the shared row. The surface must follow
  // the effective target — a shared-row-only runtime mode can never be `local`
  // for a workspace agent, which hid the directory picker.
  it.each([
    ['no target yet', undefined],
    ['cloud sandbox', { executionTarget: 'sandbox' } as LobeAgentAgencyConfig],
  ])(
    'shows the working directory picker when a workspace member overrides a shared row (%s) with local',
    (_, sharedAgencyConfig) => {
      setSharedAgent({ agencyConfig: sharedAgencyConfig, workspaceId: 'ws-1' });
      effective.agencyConfig = {
        ...sharedAgencyConfig,
        boundDeviceId: 'personal-device',
        executionTarget: 'local',
      };
      effective.workspaceScoped = false;

      const { result } = renderHook(() => useWorkspaceSurface(AGENT_ID));

      expect(result.current).toBe('workingDirectory');
    },
  );

  it('keeps the device-scoped picker for a workspace-scoped shared local target bound to a workspace device', () => {
    const shared: LobeAgentAgencyConfig = {
      boundDeviceId: 'workspace-device',
      executionTarget: 'local',
    };
    setSharedAgent({ agencyConfig: shared, workspaceId: 'ws-1' });
    effective.agencyConfig = shared;
    effective.workspaceScoped = true;

    const { result } = renderHook(() => useWorkspaceSurface(AGENT_ID));

    expect(result.current).toBe('workingDirectory');
  });

  it('hides the picker when the member override targets the cloud sandbox', () => {
    setSharedAgent({
      agencyConfig: { boundDeviceId: 'workspace-device', executionTarget: 'local' },
      workspaceId: 'ws-1',
    });
    effective.agencyConfig = { executionTarget: 'sandbox' };
    effective.workspaceScoped = false;

    const { result } = renderHook(() => useWorkspaceSurface(AGENT_ID));

    expect(result.current).toBeUndefined();
  });

  it('shows the picker for a personal agent running locally', () => {
    const shared: LobeAgentAgencyConfig = { executionTarget: 'local' };
    setSharedAgent({ agencyConfig: shared });
    effective.agencyConfig = shared;

    const { result } = renderHook(() => useWorkspaceSurface(AGENT_ID));

    expect(result.current).toBe('workingDirectory');
  });

  it('always shows the picker for a heterogeneous agent, even on a sandbox target', () => {
    const shared: LobeAgentAgencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { command: 'claude', type: 'claude-code' },
    };
    setSharedAgent({ agencyConfig: shared });
    effective.agencyConfig = shared;

    const { result } = renderHook(() => useWorkspaceSurface(AGENT_ID, true));

    expect(result.current).toBe('workingDirectory');
  });
});

describe('resolveWorkspaceSurface (web)', () => {
  const web = {
    alwaysShowWorkspace: false,
    clientExecutionAvailable: false,
    deviceRoutingAvailable: true,
    isHetero: false,
    workspaceScoped: false,
  };

  it('routes a bound local target to the device-scoped picker', () => {
    expect(
      resolveWorkspaceSurface({
        ...web,
        agencyConfig: { boundDeviceId: 'desktop-device', executionTarget: 'local' },
      }),
    ).toBe('workingDirectory');
  });

  it('offers the cloud repo switcher to heterogeneous agents', () => {
    expect(
      resolveWorkspaceSurface({
        ...web,
        agencyConfig: { executionTarget: 'sandbox' },
        isHetero: true,
      }),
    ).toBe('cloudRepo');
  });

  it('offers the cloud repo switcher when the workspace is forced on', () => {
    expect(
      resolveWorkspaceSurface({
        ...web,
        agencyConfig: { executionTarget: 'sandbox' },
        alwaysShowWorkspace: true,
      }),
    ).toBe('cloudRepo');
  });

  it('shows nothing for a plain agent without a bound device', () => {
    expect(resolveWorkspaceSurface({ ...web, agencyConfig: { executionTarget: 'local' } })).toBe(
      undefined,
    );
  });
});
