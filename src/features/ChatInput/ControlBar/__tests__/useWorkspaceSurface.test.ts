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
  // Regression: a workspace member's "Local device" pick lives in
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

      expect(result.current).toEqual(['workingDirectory']);
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

    expect(result.current).toEqual(['workingDirectory']);
  });

  it('gives the cloud sandbox its own working directory when the member override targets it', () => {
    setSharedAgent({
      agencyConfig: { boundDeviceId: 'workspace-device', executionTarget: 'local' },
      workspaceId: 'ws-1',
    });
    effective.agencyConfig = { executionTarget: 'sandbox' };
    effective.workspaceScoped = false;

    const { result } = renderHook(() => useWorkspaceSurface(AGENT_ID));

    // The device-scoped picker is still hidden — this run touches no device.
    // What it gets instead is the sandbox's own directory, which is where its
    // files actually land.
    expect(result.current).toEqual(['sandbox']);
  });

  it('shows the picker for a personal agent running locally', () => {
    const shared: LobeAgentAgencyConfig = { executionTarget: 'local' };
    setSharedAgent({ agencyConfig: shared });
    effective.agencyConfig = shared;

    const { result } = renderHook(() => useWorkspaceSurface(AGENT_ID));

    expect(result.current).toEqual(['workingDirectory']);
  });

  it('always shows the picker for a heterogeneous agent, even on a sandbox target', () => {
    const shared: LobeAgentAgencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { command: 'claude', type: 'claude-code' },
    };
    setSharedAgent({ agencyConfig: shared });
    effective.agencyConfig = shared;

    const { result } = renderHook(() => useWorkspaceSurface(AGENT_ID, true));

    expect(result.current).toEqual(['workingDirectory']);
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
    ).toEqual(['workingDirectory']);
  });

  it('offers the cloud repo switcher to a heterogeneous agent bound to a device', () => {
    expect(
      resolveWorkspaceSurface({
        ...web,
        agencyConfig: { boundDeviceId: undefined, executionTarget: 'device' },
        isHetero: true,
      }),
    ).toEqual(['cloudRepo']);
  });

  it('offers the cloud repo switcher when the workspace is forced on', () => {
    expect(
      resolveWorkspaceSurface({
        ...web,
        agencyConfig: { executionTarget: 'sandbox' },
        alwaysShowWorkspace: true,
      }),
    ).toEqual(['cloudRepo', 'sandbox']);
  });

  it('gives a heterogeneous sandbox run the repo switcher AND the sandbox directory, in that order', () => {
    // Both are relevant to such a run — which repository, and which instance it
    // runs in. Taking the repo switcher away would lose the repository; leaving
    // the sandbox out would leave the run in a throwaway box with no way to
    // choose otherwise.
    expect(
      resolveWorkspaceSurface({
        ...web,
        agencyConfig: { executionTarget: 'sandbox' },
        isHetero: true,
      }),
    ).toEqual(['cloudRepo', 'sandbox']);
  });

  it('gives a plain web run on the cloud sandbox the sandbox surface', () => {
    expect(
      resolveWorkspaceSurface({ ...web, agencyConfig: { executionTarget: 'sandbox' } }),
    ).toEqual(['sandbox']);
  });

  it('gives a plain web agent the sandbox surface, because that is where it runs', () => {
    // On web a `local` target coerces to `sandbox` — there is no client to run
    // on. The run therefore keeps its files in the sandbox, so that is the
    // working directory it gets a say over. The device-scoped picker stays
    // hidden either way: no device is involved.
    expect(resolveWorkspaceSurface({ ...web, agencyConfig: { executionTarget: 'local' } })).toEqual(
      ['sandbox'],
    );
  });
});
