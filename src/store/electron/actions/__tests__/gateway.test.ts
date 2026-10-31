import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useElectronStore } from '@/store/electron';
import { electronGatewaySelectors } from '@/store/electron/selectors';

const service = vi.hoisted(() => ({
  getDeviceInfo: vi.fn(),
  getStableDeviceId: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  getConnectionStatus: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isDesktop: true,
}));

vi.mock('@/services/electron/gatewayConnection', () => ({ gatewayConnectionService: service }));

beforeEach(() => {
  service.getDeviceInfo.mockReset();
  service.getStableDeviceId.mockReset();
  useElectronStore.setState({ gatewayDeviceInfo: undefined });
});

describe('resolveGatewayDeviceId', () => {
  // Regression: a cwd write that ran before any picker mounted read an empty
  // store and saved the path with no machine.
  it('asks the desktop for its stable id when the store has not loaded one', async () => {
    service.getStableDeviceId.mockResolvedValue('stable-1');

    await expect(useElectronStore.getState().resolveGatewayDeviceId()).resolves.toBe('stable-1');
  });

  // Regression: before the gateway connects the store holds the install's
  // fallback UUID, which no longer names this machine once the identity is derived.
  it('ignores a cached fallback id and never takes the network-backed device info path', async () => {
    useElectronStore.setState({
      gatewayDeviceInfo: { deviceId: 'fallback-uuid', hostname: 'mac', platform: 'darwin' },
    });
    service.getStableDeviceId.mockResolvedValue('stable-1');

    await expect(useElectronStore.getState().resolveGatewayDeviceId()).resolves.toBe('stable-1');
    expect(service.getDeviceInfo).not.toHaveBeenCalled();
    // The renderer's "this device" must agree with the pin just written, or the
    // next turn reads this desktop as a remote machine.
    expect(useElectronStore.getState().gatewayDeviceInfo?.deviceId).toBe('stable-1');
  });

  it('returns nothing while signed out or when the desktop cannot answer', async () => {
    service.getStableDeviceId.mockResolvedValueOnce(undefined);
    await expect(useElectronStore.getState().resolveGatewayDeviceId()).resolves.toBeUndefined();

    service.getStableDeviceId.mockRejectedValueOnce(new Error('ipc down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(useElectronStore.getState().resolveGatewayDeviceId()).resolves.toBeUndefined();
  });
});

describe('ElectronGatewayActionImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useElectronStore.setState({
      gatewayConnectionError: undefined,
      gatewayConnectionStatus: 'disconnected',
    });
  });

  it('keeps the reason a failed attempt ended with, as the main process reports it', async () => {
    vi.mocked(gatewayConnectionService.connect).mockResolvedValue({
      errorCode: 'invalid_gateway_url',
      success: false,
    });
    vi.mocked(gatewayConnectionService.getConnectionStatus).mockResolvedValue({
      error: { code: 'invalid_gateway_url' },
      status: 'disconnected',
    });

    await act(() => useElectronStore.getState().connectGateway());

    expect(useElectronStore.getState()).toMatchObject({
      gatewayConnectionError: { code: 'invalid_gateway_url' },
      gatewayConnectionStatus: 'disconnected',
    });
  });

  it('clears the previous reason when retrying', async () => {
    useElectronStore.setState({ gatewayConnectionError: { code: 'auth_failed' } });
    let finish!: (value: { success: boolean }) => void;
    vi.mocked(gatewayConnectionService.connect).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const attempt = useElectronStore.getState().connectGateway();

    expect(useElectronStore.getState()).toMatchObject({
      gatewayConnectionError: undefined,
      gatewayConnectionStatus: 'connecting',
    });
    finish({ success: true });
    await act(() => attempt);
  });

  it('applies broadcast state, error included', () => {
    act(() => {
      useElectronStore.getState().setGatewayConnectionState({
        error: { code: 'config_unavailable', detail: 'HTTP 502' },
        status: 'disconnected',
      });
    });

    expect(useElectronStore.getState().gatewayConnectionError).toEqual({
      code: 'config_unavailable',
      detail: 'HTTP 502',
    });

    act(() => {
      useElectronStore.getState().setGatewayConnectionState({ status: 'connected' });
    });

    expect(useElectronStore.getState().gatewayConnectionError).toBeUndefined();
  });
});

describe('useFetchGatewayStableDeviceId', () => {
  it('holds this machine’s stable id in the replica and corrects a cached fallback id', async () => {
    useElectronStore.setState({
      gatewayDeviceInfo: { deviceId: 'fallback-uuid', hostname: 'mac', platform: 'darwin' },
      gatewayStableDeviceIdMap: {},
    });
    service.getStableDeviceId.mockResolvedValue('stable-1');

    renderHook(() => useElectronStore.getState().useFetchGatewayStableDeviceId());

    await waitFor(() =>
      expect(electronGatewaySelectors.gatewayStableDeviceId(useElectronStore.getState())).toBe(
        'stable-1',
      ),
    );
    expect(useElectronStore.getState().gatewayDeviceInfo?.deviceId).toBe('stable-1');
  });

  it('records no device while signed out, and fetches nothing when disabled', async () => {
    useElectronStore.setState({ gatewayStableDeviceIdMap: {} });
    service.getStableDeviceId.mockResolvedValue(undefined);

    renderHook(() => useElectronStore.getState().useFetchGatewayStableDeviceId(false));
    expect(service.getStableDeviceId).not.toHaveBeenCalled();

    renderHook(() => useElectronStore.getState().useFetchGatewayStableDeviceId());
    await waitFor(() =>
      expect(electronGatewaySelectors.gatewayStableDeviceId(useElectronStore.getState())).toBe(
        null,
      ),
    );
  });
});
