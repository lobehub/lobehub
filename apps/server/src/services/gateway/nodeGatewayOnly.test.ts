import { beforeEach, describe, expect, it, vi } from 'vitest';

const routing = vi.hoisted(() => ({ host: 'default' as 'default' | 'node', nodeConfigured: true }));

vi.mock('./MessageGatewayClient', () => ({
  isMessageGatewayHostConfigured: (host: string) => host === 'node' && routing.nodeConfigured,
  resolveMessageGatewayHost: () => routing.host,
}));

const { isMessageGatewayHostingUnavailable } = await import('./nodeGatewayOnly');

const dingtalk = { id: 'dingtalk', nodeMessageGatewayOnly: true };

describe('isMessageGatewayHostingUnavailable', () => {
  beforeEach(() => {
    routing.host = 'default';
    routing.nodeConfigured = true;
  });

  it('is unavailable while the platform stays on the default gateway', () => {
    expect(isMessageGatewayHostingUnavailable(dingtalk)).toBe(true);
  });

  it('is available once the platform is routed to a configured Node gateway', () => {
    routing.host = 'node';
    expect(isMessageGatewayHostingUnavailable(dingtalk)).toBe(false);
  });

  it('is unavailable when routed to a Node gateway that is not configured', () => {
    routing.host = 'node';
    routing.nodeConfigured = false;
    expect(isMessageGatewayHostingUnavailable(dingtalk)).toBe(true);
  });

  it('never restricts platforms every gateway can host', () => {
    expect(isMessageGatewayHostingUnavailable({ id: 'discord' })).toBe(false);
    expect(isMessageGatewayHostingUnavailable(undefined)).toBe(false);
  });
});
