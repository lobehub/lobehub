import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useElectronStore } from '@/store/electron';

vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getConnectionStatus: vi.fn(),
  },
}));

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
