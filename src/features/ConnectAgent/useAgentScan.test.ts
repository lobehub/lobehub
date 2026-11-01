import type { DeviceListItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';

import {
  buildConnectAgentConfig,
  buildPlatformAgencyConfig,
  getConnectableProvider,
} from './providers';
import { scanLocal, useAgentScan } from './useAgentScan';

const detectHeterogeneousAgentCommand = vi.hoisted(() => vi.fn());

vi.mock('@/services/device', () => ({
  deviceService: { scanAgents: vi.fn() },
}));

vi.mock('@/services/electron/binary', () => ({
  binaryService: { detectHeterogeneousAgentCommand },
}));

describe('scanLocal', () => {
  beforeEach(() => {
    detectHeterogeneousAgentCommand.mockReset();
  });

  it('scans OpenClaw and Hermes alongside the local coding-agent CLIs', async () => {
    detectHeterogeneousAgentCommand.mockImplementation(async ({ agentType }) => ({
      available: true,
      version: `${agentType}-version`,
    }));

    const agents = await scanLocal();

    expect(agents['deepseek-harness']).toEqual({
      available: true,
      version: 'deepseek-harness-version',
    });
    expect(agents.openclaw).toEqual({ available: true, version: 'openclaw-version' });
    expect(agents.hermes).toEqual({ available: true, version: 'hermes-version' });
    expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
      agentType: 'openclaw',
      command: 'openclaw',
    });
    expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
      agentType: 'hermes',
      command: 'hermes',
    });
  });

  it('reports DeepSeek Harness unavailable when the dsh CLI is not installed', async () => {
    detectHeterogeneousAgentCommand.mockImplementation(async ({ agentType }) =>
      agentType === 'deepseek-harness'
        ? { available: false, error: 'dsh not found' }
        : { available: true },
    );

    const agents = await scanLocal();

    expect(detectHeterogeneousAgentCommand).toHaveBeenCalledWith({
      agentType: 'deepseek-harness',
      command: 'dsh',
    });
    expect(agents['deepseek-harness']).toMatchObject({
      available: false,
      reason: 'dsh not found',
    });
  });

  it('preserves detector and IPC failure reasons', async () => {
    detectHeterogeneousAgentCommand.mockImplementation(async ({ agentType }) => {
      if (agentType === 'openclaw') {
        return { available: false, error: 'openclaw failed validation' };
      }
      if (agentType === 'hermes') throw new Error('hermes scan timed out');
      return { available: false };
    });

    const agents = await scanLocal();

    expect(agents.openclaw).toEqual({
      available: false,
      reason: 'openclaw failed validation',
      version: undefined,
    });
    expect(agents.hermes).toEqual({
      available: false,
      reason: 'hermes scan timed out',
    });
  });
});

describe('buildPlatformAgencyConfig', () => {
  it('uses the default local target without binding a device for this computer', () => {
    expect(buildPlatformAgencyConfig('openclaw', { kind: 'local' })).toEqual({
      heterogeneousProvider: { type: 'openclaw' },
    });
  });

  it('binds a selected remote device explicitly', () => {
    expect(
      buildPlatformAgencyConfig('hermes', { deviceId: 'remote-device', kind: 'device' }),
    ).toEqual({
      boundDeviceId: 'remote-device',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'hermes' },
    });
  });
});

describe('buildConnectAgentConfig', () => {
  it('creates the DeepSeek runtime without persisting its probe command', () => {
    const provider = getConnectableProvider('deepseek-harness')!;
    const config = buildConnectAgentConfig({ provider, target: { kind: 'local' } });

    expect(config).toMatchObject({
      agencyConfig: { heterogeneousProvider: { type: 'deepseek-harness' } },
      provider: 'deepseek-harness',
      title: 'DeepSeek Harness',
    });
    expect(config.agencyConfig.heterogeneousProvider.command).toBeUndefined();
  });

  it('stores a customized label as the personal name without overwriting the platform profile', () => {
    const provider = getConnectableProvider('hermes')!;

    expect(
      buildConnectAgentConfig({
        overrides: { description: ' Custom description ', name: ' Research Agent ' },
        profile: { description: 'Profile description', title: 'default' },
        provider,
        target: { kind: 'local' },
      }),
    ).toMatchObject({
      description: 'Custom description',
      name: 'Research Agent',
      title: 'default',
    });
  });

  it('stamps the runtime type as the agent provider for platform agents', () => {
    expect(
      buildConnectAgentConfig({
        provider: getConnectableProvider('hermes')!,
        target: { kind: 'local' },
      }),
    ).toMatchObject({ provider: 'hermes' });
  });

  it('stamps the runtime type as the agent provider for CLI agents', () => {
    expect(
      buildConnectAgentConfig({
        provider: getConnectableProvider('claude-code')!,
        target: { deviceId: 'device-1', kind: 'device' },
      }),
    ).toMatchObject({ provider: 'claude-code' });
  });
});

describe('useAgentScan', () => {
  const device = { deviceId: 'dev_1' } as DeviceListItem;
  const scanAgents = vi.mocked(deviceService.scanAgents);
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

  beforeEach(() => {
    scanAgents.mockReset();
  });

  it('stays idle without a target', () => {
    const { result } = renderHook(() => useAgentScan(null), { wrapper });

    expect(result.current.state).toEqual({ agents: null, status: 'idle' });
    expect(scanAgents).not.toHaveBeenCalled();
  });

  it('scans the target device as soon as it is given', async () => {
    const agents = { 'claude-code': { available: true, version: '1.0.0' } };
    scanAgents.mockResolvedValue({ agents } as any);

    const { result } = renderHook(() => useAgentScan({ device, kind: 'device' }), { wrapper });

    expect(result.current.state.status).toBe('scanning');
    await waitFor(() => expect(result.current.state).toEqual({ agents, status: 'success' }));
    expect(scanAgents).toHaveBeenCalledWith({ deviceId: 'dev_1' });
  });

  it('reports a device-side scan failure and re-probes on rescan', async () => {
    scanAgents.mockResolvedValueOnce({ agents: null, error: 'device offline' } as any);

    const { result } = renderHook(() => useAgentScan({ device, kind: 'device' }), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        agents: null,
        error: 'device offline',
        status: 'error',
      }),
    );

    const agents = { codex: { available: true } };
    scanAgents.mockResolvedValueOnce({ agents } as any);
    act(() => result.current.rescan());

    await waitFor(() => expect(result.current.state).toEqual({ agents, status: 'success' }));
    expect(scanAgents).toHaveBeenCalledTimes(2);
  });

  it('does not re-probe on its own when the connection comes back', async () => {
    scanAgents.mockResolvedValue({ agents: {} } as any);
    let reconnect: (() => void) | undefined;
    const reconnectWrapper = ({ children }: PropsWithChildren) =>
      createElement(
        SWRConfig,
        {
          value: {
            initReconnect: (callback: () => void) => {
              reconnect = callback;
            },
            provider: () => new Map(),
          },
        },
        children,
      );

    const { result } = renderHook(() => useAgentScan({ device, kind: 'device' }), {
      wrapper: reconnectWrapper,
    });
    await waitFor(() => expect(result.current.state.status).toBe('success'));

    expect(reconnect).toBeDefined();
    await act(async () => {
      reconnect!();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(result.current.state.status).toBe('success');
    expect(scanAgents).toHaveBeenCalledTimes(1);
  });
});
