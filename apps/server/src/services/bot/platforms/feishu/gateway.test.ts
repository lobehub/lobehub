import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INBOUND_FORWARD_FAILED_ERROR_CODE, SelfWebhookForwardMonitor } from '../selfWebhook';
import { FeishuWSConnection } from './gateway';

const { updateBotRuntimeStatus } = vi.hoisted(() => ({
  updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: { connected: 'connected', failed: 'failed' },
  updateBotRuntimeStatus,
}));

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

const onForwardResult = vi.fn();

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
      onForwardResult,
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
      expect(onForwardResult).toHaveBeenCalledWith({ ok: true, status: 200 });
    });

    // #23215: an unreachable loopback used to end in a debug-only log line,
    // so every message vanished while the bot looked connected.
    it('reports a forward the server never answered', async () => {
      const refused = Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED' },
      });
      vi.mocked(fetch).mockRejectedValueOnce(refused);
      const conn = createConnection();
      await conn.start();

      await capturedEventHandlers['im.message.receive_v1']({ message: { chat_id: 'oc_test' } });

      expect(onForwardResult).toHaveBeenCalledWith({ error: refused, ok: false });
    });

    it('turns an unreachable loopback into an error log and a failed bot status', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(fetch).mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
      );
      const webhookUrl = 'https://lobe.tailnet.example/api/agent/webhooks/feishu/cli_test';
      const monitor = new SelfWebhookForwardMonitor({
        applicationId: 'cli_test',
        platform: 'feishu',
        webhookUrl,
      });
      const conn = new FeishuWSConnection({
        appId: 'cli_test',
        appSecret: 'test_secret',
        domain: 'feishu',
        onForwardResult: monitor.record,
        webhookUrl,
      });
      await conn.start();

      await capturedEventHandlers['im.message.receive_v1']({ message: { chat_id: 'oc_test' } });
      await vi.waitFor(() => expect(updateBotRuntimeStatus).toHaveBeenCalled());

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\[bot-platform:feishu\] Dropped an inbound event for cli_test: forwarding it to https:\/\/lobe\.tailnet\.example\/api\/agent\/webhooks\/feishu\/cli_test failed \(ECONNREFUSED\); 1 dropped in a row\./,
        ),
      );
      expect(updateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'cli_test',
          errorCode: INBOUND_FORWARD_FAILED_ERROR_CODE,
          platform: 'feishu',
          status: 'failed',
        }),
        expect.anything(),
      );
      expect(monitor.consecutiveFailures).toBe(1);
    });

    it('reports a forward the webhook route rejected', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('Invalid verification token', { status: 401 }),
      );
      const conn = createConnection();
      await conn.start();

      await capturedEventHandlers['im.message.receive_v1']({ message: { chat_id: 'oc_test' } });

      expect(onForwardResult).toHaveBeenCalledWith({ ok: false, status: 401 });
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
