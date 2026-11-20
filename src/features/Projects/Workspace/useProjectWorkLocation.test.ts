import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectWorkLocation } from './useProjectWorkLocation';

const mocks = vi.hoisted(() => ({
  agency: {
    agencyConfig: undefined as
      | {
          boundDeviceId?: string;
          executionTarget?: string;
          heterogeneousProvider?: { type: string };
        }
      | undefined,
    canDisplayExecutionTarget: true,
    canSelectExecutionTarget: true,
    workspaceScoped: false,
  },
  selectExecutionTarget: vi.fn(),
  selectTarget: vi.fn(),
  topicDeviceId: undefined as string | undefined,
}));

vi.mock('@/features/ChatInput/ControlBar/useTopicAwareTargetSelect', () => ({
  useTopicAwareTargetSelect: () => ({
    selectTarget: mocks.selectTarget,
    topicDeviceId: mocks.topicDeviceId,
  }),
}));

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => mocks.agency,
}));

vi.mock('@/helpers/gatewayMode', () => ({ useIsGatewayModeEnabled: () => true }));

vi.mock('@/features/ChatInput/hooks/useSelectExecutionTarget', () => ({
  useSelectExecutionTarget: () => mocks.selectExecutionTarget,
}));

vi.mock('@/store/device', () => ({
  useDeviceList: () => ({
    data: [
      { deviceId: 'device_1', friendlyName: 'Studio Mac', online: true, scope: 'personal' },
      { deviceId: 'device_2', friendlyName: 'Build box', online: false, scope: 'personal' },
    ],
  }),
}));

const render = () => renderHook(() => useProjectWorkLocation('agent_1')).result.current;

beforeEach(() => {
  mocks.agency.agencyConfig = { executionTarget: 'sandbox' };
  mocks.agency.canSelectExecutionTarget = true;
  mocks.selectExecutionTarget.mockReset();
  mocks.selectExecutionTarget.mockResolvedValue(true);
  mocks.selectTarget.mockReset();
  mocks.selectTarget.mockResolvedValue(undefined);
  mocks.topicDeviceId = undefined;
});

describe('useProjectWorkLocation', () => {
  // An open conversation is on the machine it ran on, and moves through the
  // topic-aware pick that confirms leaving it.
  it("reads and moves an open conversation's own place", async () => {
    mocks.agency.agencyConfig = { boundDeviceId: 'device_2', executionTarget: 'device' };
    mocks.topicDeviceId = 'device_1';
    const location = renderHook(() => useProjectWorkLocation('agent_1', 'topic_1')).result.current;

    expect(location.boundDevice?.deviceId).toBe('device_1');
    expect(location.machineDeviceId).toBe('device_1');

    await expect(location.select('sandbox')).resolves.toBe(true);
    expect(mocks.selectTarget).toHaveBeenCalledWith('sandbox', undefined, undefined);
    expect(mocks.selectExecutionTarget).not.toHaveBeenCalled();
  });

  it('moves a cloud-sandbox agent to one of its devices', async () => {
    const location = render();

    expect(location.target).toBe('sandbox');
    expect(location.deviceRows.map((device) => device.deviceId)).toEqual(['device_1', 'device_2']);

    expect(location.machineDeviceId).toBeUndefined();

    await expect(location.select('device', 'device_1')).resolves.toBe(true);
    expect(mocks.selectExecutionTarget).toHaveBeenCalledWith('device', 'device_1', undefined);
  });

  it('moves a device agent back to the cloud sandbox', async () => {
    mocks.agency.agencyConfig = { boundDeviceId: 'device_1', executionTarget: 'device' };
    const location = render();

    expect(location.boundDevice?.friendlyName).toBe('Studio Mac');
    // The machine whose project folders the conversation can start in.
    expect(location.machineDeviceId).toBe('device_1');

    await location.select('sandbox');
    expect(mocks.selectExecutionTarget).toHaveBeenCalledWith('sandbox', undefined, undefined);
  });

  it('moves between devices but writes nothing for the current one', async () => {
    mocks.agency.agencyConfig = { boundDeviceId: 'device_1', executionTarget: 'device' };
    const location = render();

    await location.select('device', 'device_1');
    expect(mocks.selectExecutionTarget).not.toHaveBeenCalled();

    await location.select('device', 'device_2');
    expect(mocks.selectExecutionTarget).toHaveBeenCalledWith('device', 'device_2', undefined);
  });

  it('reports a move that was not saved', async () => {
    mocks.selectExecutionTarget.mockResolvedValue(false);

    await expect(render().select('device', 'device_1')).resolves.toBe(false);
  });

  it('does not offer the cloud sandbox to a device-only provider', () => {
    mocks.agency.agencyConfig = {
      boundDeviceId: 'device_1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'amp' },
    };

    expect(render().sandboxAvailable).toBe(false);
  });

  // A fixed device still has project folders to choose between.
  it('keeps the fixed device listed so its folders stay a choice', () => {
    mocks.agency.canSelectExecutionTarget = false;
    mocks.agency.agencyConfig = { boundDeviceId: 'device_1', executionTarget: 'device' };
    const location = render();

    expect(location.switchable).toBe(false);
    expect(location.deviceRows.map((device) => device.deviceId)).toEqual(['device_1']);
    expect(location.machineDeviceId).toBe('device_1');
  });

  it('offers no other place when the target is fixed', () => {
    mocks.agency.canSelectExecutionTarget = false;
    const location = render();

    expect(location.switchable).toBe(false);
    expect(location.deviceRows).toEqual([]);
    expect(location.localAvailable).toBe(false);
  });
});
