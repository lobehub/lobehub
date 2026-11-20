/**
 * Shared fakes for the DeviceGateway scenario tests. Each test file keeps its
 * own `vi.mock` calls (Vitest hoists them per file) and points the factories
 * here, so every file drives the same fake gateway client and env.
 */
import { vi } from 'vitest';

export const mockEnv = {
  DEVICE_GATEWAY_SERVICE_TOKEN: undefined as string | undefined,
  DEVICE_GATEWAY_URL: undefined as string | undefined,
};

export const mockClient = {
  dispatchAgentRun: vi.fn(),
  executeMcpCall: vi.fn(),
  executeMessageApi: vi.fn(),
  executeToolCall: vi.fn(),
  getDeviceMetrics: vi.fn(),
  getDeviceSystemInfo: vi.fn(),
  invokeRpc: vi.fn(),
  queryDeviceList: vi.fn(),
  queryDeviceStatus: vi.fn(),
};

export const MockGatewayHttpClient = vi.fn(function () {
  return mockClient;
});

// The send-path cache rides on the Redis service; hand its connection seam a
// fake client so the test sees which key and TTL the gateway asked for,
// independent of whether this environment has Redis configured.
export const cacheRedis = { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') };
export const getRedisServiceClient = vi.fn(async () => cacheRedis);

/** Point the gateway env at a fake deployment so `getClient()` builds a client. */
export const configureGateway = () => {
  mockEnv.DEVICE_GATEWAY_URL = 'https://gateway.example.com';
  mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = 'token';
};

/** Per-test reset: clear call history and leave the gateway unconfigured. */
export const resetGatewayMocks = () => {
  vi.clearAllMocks();
  mockEnv.DEVICE_GATEWAY_URL = undefined;
  mockEnv.DEVICE_GATEWAY_SERVICE_TOKEN = undefined;
};
