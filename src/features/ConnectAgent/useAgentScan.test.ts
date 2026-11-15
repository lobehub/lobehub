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
  CONNECTABLE_PROVIDERS,
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
  const types = CONNECTABLE_PROVIDERS.map((provider) => provider.type);
  const [first, second, ...others] = types;
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  /** One pending reply per requested type, resolved by the test. */
  const holdProbes = () => {
    const probes = new Map<string, ReturnType<typeof deferred<any>>>();
    scanAgents.mockImplementation(((input: { agentTypes: string[] }) => {
      const probe = deferred<any>();
      probes.set(input.agentTypes[0], probe);
      return probe.promise;
    }) as any);
    return probes;
  };

  beforeEach(() => {
    scanAgents.mockReset();
  });

  it('stays idle without a target', () => {
    const { result } = renderHook(() => useAgentScan(null), { wrapper });

    expect(result.current.state).toEqual({ agents: null, status: 'idle' });
    expect(scanAgents).not.toHaveBeenCalled();
  });

  it('probes the first agent alone, then shows every other agent as its probe lands', async () => {
    const probes = holdProbes();
    const { result } = renderHook(() => useAgentScan({ device, kind: 'device' }), { wrapper });

    await waitFor(() => expect(scanAgents).toHaveBeenCalledTimes(1));
    expect(scanAgents).toHaveBeenCalledWith({ agentTypes: [first], deviceId: 'dev_1' });
    expect(result.current.state).toEqual({ agents: {}, settled: [], status: 'scanning' });

    await act(async () => {
      probes.get(first)!.resolve({ agents: { [first]: { available: true, version: '1.0.0' } } });
    });
    // The first reply honoured the filter: the rest fan out at once
    await waitFor(() => expect(scanAgents).toHaveBeenCalledTimes(types.length));
    expect(result.current.state).toEqual({
      agents: { [first]: { available: true, version: '1.0.0' } },
      settled: [first],
      status: 'scanning',
    });

    await act(async () => {
      probes.get(second)!.resolve({ agents: { [second]: { available: false } } });
    });
    expect(result.current.state.status).toBe('scanning');
    expect(result.current.state.settled).toEqual([first, second]);
    expect(result.current.state.agents?.[second]).toEqual({ available: false });

    await act(async () => {
      for (const type of others) probes.get(type)!.resolve({ agents: {} });
    });

    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(result.current.state.agents).toEqual({
      [first]: { available: true, version: '1.0.0' },
      [second]: { available: false },
    });
    // Arrival order outlives the scan so the finished list does not reshuffle
    expect(result.current.state.settled).toEqual([first, second, ...others]);
  });

  it('takes the full map from a device that predates the type filter without fanning out', async () => {
    const agents = { codex: { available: true }, [first]: { available: true, version: '2' } };
    scanAgents.mockResolvedValue({ agents } as any);

    const { result } = renderHook(() => useAgentScan({ device, kind: 'device' }), { wrapper });

    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(result.current.state.agents).toEqual(agents);
    expect(scanAgents).toHaveBeenCalledTimes(1);
  });

  it('marks only the probes that failed unavailable, with the reason', async () => {
    scanAgents.mockImplementation((async ({ agentTypes: [type] }: { agentTypes: string[] }) => {
      if (type === first) return { agents: { [first]: { available: true } } };
      if (type === second) return { agents: {}, error: 'probe timed out' };
      if (type === others[0]) throw new Error('network down');
      return { agents: {} };
    }) as any);

    const { result } = renderHook(() => useAgentScan({ device, kind: 'device' }), { wrapper });

    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(result.current.state.agents).toEqual({
      [first]: { available: true },
      [others[0]]: { available: false, reason: 'network down' },
      [second]: { available: false, reason: 'probe timed out' },
    });
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
    // An unanswered first probe stops the scan: no fan-out to a dead device
    expect(scanAgents).toHaveBeenCalledTimes(1);

    const agents = { [first]: { available: true }, codex: { available: true } };
    scanAgents.mockResolvedValueOnce({ agents } as any);
    act(() => result.current.rescan());

    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(result.current.state.agents).toEqual(agents);
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
    const probes = scanAgents.mock.calls.length;

    expect(reconnect).toBeDefined();
    await act(async () => {
      reconnect!();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(result.current.state.status).toBe('success');
    expect(scanAgents).toHaveBeenCalledTimes(probes);
  });

  it('shows local agents one by one as each detector call settles', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<any>>>();
    detectHeterogeneousAgentCommand.mockImplementation(({ agentType }) => {
      const probe = deferred<any>();
      pending.set(agentType, probe);
      return probe.promise;
    });

    const { result } = renderHook(() => useAgentScan({ kind: 'local' }), { wrapper });
    await waitFor(() => expect(pending.size).toBe(types.length));

    await act(async () => {
      pending.get(second)!.resolve({ available: true, version: '3.0.0' });
    });
    expect(result.current.state).toEqual({
      agents: { [second]: { available: true, version: '3.0.0' } },
      settled: [second],
      status: 'scanning',
    });

    await act(async () => {
      for (const type of [first, ...others]) pending.get(type)!.resolve({ available: false });
    });
    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(Object.keys(result.current.state.agents ?? {})).toHaveLength(types.length);
  });
});
