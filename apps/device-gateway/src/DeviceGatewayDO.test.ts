import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyDesktopToken } from './auth';
import { DeviceGatewayDO } from './DeviceGatewayDO';

const storageGet = vi.fn();

vi.mock('./auth', () => ({
  verifyApiKeyToken: vi.fn(),
  verifyDesktopToken: vi.fn(),
}));

class FakeWebSocket {
  public attachment: any;
  public closed: { code: number; reason: string } | null = null;
  public sent: string[] = [];

  constructor(attachment: any) {
    this.attachment = attachment;
  }

  close(code: number, reason: string) {
    this.closed = { code, reason };
  }

  deserializeAttachment() {
    return this.attachment;
  }

  send(message: string) {
    this.sent.push(message);
  }

  serializeAttachment(attachment: any) {
    this.attachment = attachment;
  }
}

describe('DeviceGatewayDO auth', () => {
  beforeEach(() => {
    storageGet.mockReset();
    vi.mocked(verifyDesktopToken).mockReset();
  });

  function createGateway() {
    return new DeviceGatewayDO(
      {
        acceptWebSocket: vi.fn(),
        getWebSockets: vi.fn().mockReturnValue([]),
        storage: {
          get: storageGet,
          getAlarm: vi.fn(),
          setAlarm: vi.fn(),
        },
      } as any,
      {
        SERVICE_TOKEN: 'service-secret',
      } as any,
    );
  }

  it('rejects clients that only self-declare serviceToken mode', async () => {
    storageGet.mockResolvedValue('user-123');
    vi.mocked(verifyDesktopToken).mockRejectedValue(new Error('invalid jwt'));

    const gateway = createGateway();
    const ws = new FakeWebSocket({ authenticated: false, lastHeartbeat: Date.now() });

    await gateway.webSocketMessage(
      ws as any,
      JSON.stringify({ type: 'auth', token: 'attacker-token', tokenType: 'serviceToken' }),
    );

    expect(verifyDesktopToken).toHaveBeenCalledWith(expect.anything(), 'attacker-token');
    expect(ws.sent).toContain(JSON.stringify({ reason: 'invalid jwt', type: 'auth_failed' }));
    expect(ws.closed).toEqual({ code: 1008, reason: 'invalid jwt' });
    expect(ws.attachment.authenticated).toBe(false);
  });

  it('accepts the real service token', async () => {
    storageGet.mockResolvedValue('user-123');

    const gateway = createGateway();
    const ws = new FakeWebSocket({ authenticated: false, lastHeartbeat: Date.now() });

    await gateway.webSocketMessage(
      ws as any,
      JSON.stringify({ type: 'auth', token: 'service-secret', tokenType: 'serviceToken' }),
    );

    expect(verifyDesktopToken).not.toHaveBeenCalled();
    expect(ws.sent).toContain(JSON.stringify({ type: 'auth_success' }));
    expect(ws.closed).toBeNull();
    expect(ws.attachment.authenticated).toBe(true);
  });
});
