// @vitest-environment node
import type { AgentDeviceOverride, LobeAgentAgencyConfig } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { DeviceBindingCandidate } from '@/database/models/agent';

import { selectAgentDeviceBindings, selectEffectivelyBoundAgents } from '../deviceBoundAgents';

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/workspaceUserSettings', () => ({ WorkspaceUserSettingsModel: vi.fn() }));
vi.mock('@/server/services/resourcePermission', () => ({ isResourceAuthorOrAdmin: vi.fn() }));

const candidate = (
  id: string,
  agencyConfig: LobeAgentAgencyConfig | null,
  extra: Partial<DeviceBindingCandidate> = {},
): DeviceBindingCandidate => ({
  agencyConfig,
  avatar: null,
  backgroundColor: null,
  id,
  name: null,
  title: id,
  userId: 'owner',
  visibility: 'public',
  workspaceId: 'ws',
  ...extra,
});

const select = (
  candidates: DeviceBindingCandidate[],
  deviceId: string,
  overrides: Record<string, AgentDeviceOverride> = {},
  canManage: string[] = [],
) =>
  selectEffectivelyBoundAgents(candidates, {
    canManage: new Set(canManage),
    deviceId,
    overrides,
  }).map((agent) => agent.id);

const onA: LobeAgentAgencyConfig = { boundDeviceId: 'device-a', executionTarget: 'device' };

describe('selectEffectivelyBoundAgents', () => {
  it('keeps a stored binding the caller has not overridden', () => {
    expect(select([candidate('agent', onA)], 'device-a')).toEqual(['agent']);
  });

  it('moves an agent the caller overrode to another device off the stored one', () => {
    const agents = [candidate('agent', onA)];
    const overrides = { agent: { boundDeviceId: 'device-b', executionTarget: 'device' as const } };

    expect(select(agents, 'device-a', overrides)).toEqual([]);
    expect(select(agents, 'device-b', overrides)).toEqual(['agent']);
  });

  it('drops an agent the caller moved to the sandbox', () => {
    expect(
      select([candidate('agent', onA)], 'device-a', { agent: { executionTarget: 'sandbox' } }),
    ).toEqual([]);
  });

  it("ignores a member's override on a fixed agent but honors a manager's", () => {
    const fixed = candidate('agent', { ...onA, executionTargetSelectionPolicy: 'fixed' });
    const overrides = { agent: { boundDeviceId: 'device-b', executionTarget: 'device' as const } };

    expect(select([fixed], 'device-a', overrides)).toEqual(['agent']);
    expect(select([fixed], 'device-b', overrides)).toEqual([]);
    expect(select([fixed], 'device-b', overrides, ['agent'])).toEqual(['agent']);
  });

  it('keeps a personal local pick and returns display fields only', () => {
    const [agent] = selectEffectivelyBoundAgents(
      [
        candidate(
          'agent',
          { boundDeviceId: 'device-a', executionTarget: 'local' },
          { workspaceId: null },
        ),
      ],
      { canManage: new Set(), deviceId: 'device-a', overrides: {} },
    );

    expect(agent).toEqual({
      avatar: null,
      backgroundColor: null,
      id: 'agent',
      name: null,
      title: 'agent',
      visibility: 'public',
    });
  });
});

describe('selectAgentDeviceBindings', () => {
  const bind = (
    candidates: DeviceBindingCandidate[],
    overrides: Record<string, AgentDeviceOverride> = {},
    canManage: string[] = [],
  ) => selectAgentDeviceBindings(candidates, { canManage: new Set(canManage), overrides });

  it('maps each agent to the device its stored config routes to', () => {
    expect(
      bind([
        candidate('device-agent', onA),
        candidate('local-agent', { boundDeviceId: 'device-b', executionTarget: 'local' }),
      ]),
    ).toEqual({ 'device-agent': 'device-a', 'local-agent': 'device-b' });
  });

  it('leaves out an agent whose stale binding the execution target does not use', () => {
    // A binding lingers after switching to the sandbox / none; `auto` treats it as stale.
    expect(
      bind([
        candidate('sandbox', { boundDeviceId: 'device-a', executionTarget: 'sandbox' }),
        candidate('none', { boundDeviceId: 'device-a', executionTarget: 'none' }),
        candidate('auto', { boundDeviceId: 'device-a', executionTarget: 'auto' }),
        candidate('unbound', null),
      ]),
    ).toEqual({});
  });

  it("applies the caller's own override over the shared binding", () => {
    const agents = [candidate('moved', onA), candidate('to-sandbox', onA)];

    expect(
      bind(agents, {
        'moved': { boundDeviceId: 'device-b', executionTarget: 'device' },
        'to-sandbox': { executionTarget: 'sandbox' },
      }),
    ).toEqual({ moved: 'device-b' });
  });

  it('ignores a member override on a fixed agent but honours the manager override', () => {
    const fixed = candidate('fixed', { ...onA, executionTargetSelectionPolicy: 'fixed' });
    const overrides = { fixed: { boundDeviceId: 'device-b', executionTarget: 'device' as const } };

    expect(bind([fixed], overrides)).toEqual({ fixed: 'device-a' });
    expect(bind([fixed], overrides, ['fixed'])).toEqual({ fixed: 'device-b' });
  });
});
