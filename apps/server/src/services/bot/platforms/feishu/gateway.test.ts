import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeishuWSConnection } from './gateway';

// ---- Mock @larksuiteoapi/node-sdk ----

const mockStart = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn();
let capturedEventHandlers: Record<string, (...args: any[]) => any> = {};

vi.mock('@larksuiteoapi/node-sdk', () => {
  class MockEventDispatcher {
    register(handles: Record<string, (...args: any[]) => any>) {
      capturedEventHandlers = { ...capturedEventHandlers, ...handles };
      return this;
    }
  }

  class MockWSClient {
    close = mockClose;
    start = mockStart;
    constructor() {}
  }

  return {
    Domain: { Feishu: 0, Lark: 1 },
    EventDispatcher: MockEventDispatcher,
    LoggerLevel: { info: 3 },
    WSClient: MockWSClient,
  };
});

// ---- Tests ----

describe('FeishuWSConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedEventHandlers = {};
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function createConnection(
    overrides?: Partial<Parameters<(typeof FeishuWSConnection)['prototype']['start']>>,
  ) {
    return new FeishuWSConnection({
      appId: 'cli_test',
      appSecret: 'test_secret',
      domain: 'feishu',
      webhookUrl: 'http://localhost:3000/api/agent/webhooks/feishu/test_app',
    });
  }

  describe('start', () => {
    it('should call WSClient.start with EventDispatcher', async () => {
      const conn = createConnection();
      await conn.start();

      expect(mockStart).toHaveBeenCalledWith(
        expect.objectContaining({ eventDispatcher: expect.any(Object) }),
      );
    });

    it('should register im.message.receive_v1 handler', async () => {
      const conn = createConnection();
      await conn.start();

      expect(capturedEventHandlers['im.message.receive_v1']).toBeTypeOf('function');
    });
  });

  describe('event forwarding', () => {
    it('should forward im.message.receive_v1 events to webhook URL', async () => {
      const conn = createConnection();
      await conn.start();

      const eventData = {
        message: {
          chat_id: 'oc_test',
          content: '{"text":"hello"}',
          message_type: 'text',
        },
        sender: { sender_id: { open_id: 'ou_test' } },
      };

      await capturedEventHandlers['im.message.receive_v1'](eventData);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/agent/webhooks/feishu/test_app',
        expect.objectContaining({
          body: expect.any(String),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }),
      );

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.schema).toBe('2.0');
      expect(body.header.event_type).toBe('im.message.receive_v1');
      expect(body.event).toEqual(eventData);
    });
  });

  describe('close', () => {
    it('should call wsClient.close()', async () => {
      const conn = createConnection();
      await conn.start();

      conn.close();
      expect(mockClose).toHaveBeenCalledWith({ force: true });
    });

    it('should be safe to call close() without starting', () => {
      const conn = createConnection();
      conn.close(); // Should not throw
    });
  });
});
