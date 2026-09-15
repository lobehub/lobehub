// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gatewayCron } from '../gatewayCron';

const mockService = vi.hoisted(() => ({
  ensureRunning: vi.fn(),
  useMessageGateway: false,
}));

vi.mock('@/server/services/gateway', () => ({
  GatewayService: class {
    get useMessageGateway() {
      return mockService.useMessageGateway;
    }
    ensureRunning = mockService.ensureRunning;
  },
}));

describe('gatewayCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.ensureRunning.mockResolvedValue(undefined);
    delete process.env.MESSAGE_GATEWAY_URL;
    delete process.env.MESSAGE_GATEWAY_SERVICE_TOKEN;
  });

  const runCron = () => gatewayCron({ json: (body: unknown) => body } as never);

  it('reconciles through the gateway even with no MESSAGE_GATEWAY_URL', async () => {
    // Node-only deployment: the owning host has a URL, the default host does
    // not. Gating this entry on MESSAGE_GATEWAY_URL would drop such a
    // deployment into the legacy path, where nothing ever reconciles the
    // connections the Node gateway is holding.
    mockService.useMessageGateway = true;

    await expect(runCron()).resolves.toEqual({ ensureRunning: true });
    expect(mockService.ensureRunning).toHaveBeenCalledTimes(1);
  });

  it('does not reconcile through the gateway when no host is enabled', async () => {
    mockService.useMessageGateway = false;
    process.env.MESSAGE_GATEWAY_URL = 'https://message-gateway.test.com';
    process.env.MESSAGE_GATEWAY_SERVICE_TOKEN = 'token';

    // Falls through to the legacy in-process path, whose dependencies are not
    // stubbed here — reaching it at all is the assertion.
    await runCron().catch(() => undefined);

    expect(mockService.ensureRunning).not.toHaveBeenCalled();
  });
});
