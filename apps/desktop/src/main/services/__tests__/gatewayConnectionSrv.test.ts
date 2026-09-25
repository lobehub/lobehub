import type { GatewayClient } from '@lobechat/device-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import GatewayConnectionService from '../gatewayConnectionSrv';

const { getDesktopEnvMock, getShellInfoMock } = vi.hoisted(() => ({
  getDesktopEnvMock: vi.fn(() => ({})),
  getShellInfoMock: vi.fn(),
}));

vi.mock('@/env', () => ({ getDesktopEnv: getDesktopEnvMock }));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/mock/path/${name}`),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn() },
}));

vi.mock('@lobechat/local-file-shell/shell', () => ({ getShellInfo: getShellInfoMock }));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const createClient = () =>
  ({ sendSystemInfoResponse: vi.fn() }) as unknown as GatewayClient & {
    sendSystemInfoResponse: ReturnType<typeof vi.fn>;
  };

describe('GatewayConnectionService system_info_request', () => {
  let service: GatewayConnectionService;

  beforeEach(() => {
    getShellInfoMock.mockReset();
    service = new GatewayConnectionService({} as App);
  });

  it('answers with the collected system info', async () => {
    getShellInfoMock.mockResolvedValue({ displayName: 'zsh' });
    const client = createClient();

    await (service as any).handleSystemInfoRequest(client, { requestId: 'req-1' });

    expect(client.sendSystemInfoResponse).toHaveBeenCalledWith({
      requestId: 'req-1',
      result: {
        success: true,
        systemInfo: expect.objectContaining({
          defaultShell: 'zsh',
          homePath: '/mock/path/home',
          picturesPath: '/mock/path/pictures',
        }),
      },
    });
  });

  it('omits an optional folder Electron cannot resolve and still answers successfully', async () => {
    getShellInfoMock.mockResolvedValue({ displayName: 'pwsh' });
    const { app } = await import('electron');
    const getPath = vi.mocked(app.getPath);
    const original = getPath.getMockImplementation();
    getPath.mockImplementation((name: string) => {
      if (name === 'pictures') throw new Error("Failed to get 'pictures' path");
      return `/mock/path/${name}`;
    });
    const client = createClient();

    try {
      await (service as any).handleSystemInfoRequest(client, { requestId: 'req-3' });
    } finally {
      getPath.mockImplementation(original!);
    }

    const [response] = client.sendSystemInfoResponse.mock.calls[0];
    expect(response.requestId).toBe('req-3');
    expect(response.result.success).toBe(true);
    expect(response.result.systemInfo.picturesPath).toBeUndefined();
    expect(response.result.systemInfo.homePath).toBe('/mock/path/home');
  });

  it('still answers with a failure when collecting system info rejects', async () => {
    getShellInfoMock.mockRejectedValue(new Error('shell probe failed'));
    const client = createClient();

    await expect(
      (service as any).handleSystemInfoRequest(client, { requestId: 'req-2' }),
    ).resolves.toBeUndefined();

    expect(client.sendSystemInfoResponse).toHaveBeenCalledWith({
      requestId: 'req-2',
      result: { success: false },
    });
  });
});

describe('GatewayConnectionService gateway override', () => {
  it('keeps the explicit environment override for cloud development', () => {
    getDesktopEnvMock.mockReturnValueOnce({ DEVICE_GATEWAY_URL: 'http://localhost:8787' });
    const service = new GatewayConnectionService({
      storeManager: {
        get: vi.fn((key: string) => {
          if (key === 'dataSyncConfig') return { storageMode: 'cloud' };
          if (key === 'gatewayUrl') return 'https://self-hosted.example.com/device-gateway';
        }),
      },
    } as unknown as App);

    expect((service as any).getGatewayUrl()).toBe('http://localhost:8787');
  });
});
