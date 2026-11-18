// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signWebhookPayload } from '@/server/services/developerWebhook/signature';

const { postSignedWebhook } = vi.hoisted(() => ({ postSignedWebhook: vi.fn() }));

vi.mock('@/server/services/developerWebhook/send', () => ({ postSignedWebhook }));

const { BotWebhookAdapter } = await import('./adapter');

const SECRET = 's'.repeat(40);
const TARGET = {
  botId: 'my-bot',
  callbackUrl: 'https://example.com/callback',
  signingSecret: SECRET,
};

const MESSAGE = {
  attachments: [{ name: 'a.png', type: 'image', url: 'https://cdn.example.com/a.png' }],
  conversationId: 'room:1',
  id: 'msg-1',
  mentioned: true,
  text: 'hello bot',
  threadId: 't-9',
  user: { id: 'u-1', name: 'Alice' },
};

const makeAdapter = async () => {
  const adapter = new BotWebhookAdapter(TARGET);
  const processMessage = vi.fn();
  await adapter.initialize({
    getLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    getUserName: () => 'Support Agent',
    processMessage,
  } as any);
  return { adapter, processMessage };
};

const signedRequest = (
  payload: unknown,
  { secret = SECRET, timestamp = Math.floor(Date.now() / 1000) } = {},
) => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Request('https://lobehub.test/api/agent/webhooks/custom/my-bot', {
    body,
    headers: {
      'X-LobeHub-Signature': signWebhookPayload(secret, timestamp, body),
      'X-LobeHub-Timestamp': String(timestamp),
    },
    method: 'POST',
  });
};

beforeEach(() => {
  postSignedWebhook.mockReset();
  postSignedWebhook.mockResolvedValue({
    durationMs: 1,
    error: null,
    permanent: false,
    responseBody: 'ok',
    responseStatus: 200,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BotWebhookAdapter.handleWebhook (inbound)', () => {
  it('dispatches a correctly signed message to the Chat SDK', async () => {
    const { adapter, processMessage } = await makeAdapter();

    const res = await adapter.handleWebhook(signedRequest({ message: MESSAGE, type: 'message' }));

    expect(res.status).toBe(200);
    const threadId = 'webhook:group:room%3A1:t-9';
    expect(await res.json()).toEqual({ ok: true, threadId });
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, dispatchedThread, factory] = processMessage.mock.calls[0];
    expect(dispatchedThread).toBe(threadId);
    const message = await factory();
    expect(message).toMatchObject({
      author: { fullName: 'Alice', userId: 'u-1' },
      id: `${threadId}#msg-1`,
      isMention: true,
      text: 'hello bot',
      threadId,
    });
    expect(message.attachments).toEqual([
      expect.objectContaining({
        name: 'a.png',
        type: 'image',
        url: 'https://cdn.example.com/a.png',
      }),
    ]);
  });

  it('scopes the message id to its thread, so per-chat ids never collide in dedupe', async () => {
    const { adapter } = await makeAdapter();

    const a = adapter.parseMessage({ ...MESSAGE, conversationId: 'chat-a', id: '1001' } as any);
    const b = adapter.parseMessage({ ...MESSAGE, conversationId: 'chat-b', id: '1001' } as any);

    expect(a.id).not.toBe(b.id);
    expect(a.raw.id).toBe('1001');
  });

  it('answers a signed ping without dispatching', async () => {
    const { adapter, processMessage } = await makeAdapter();

    const res = await adapter.handleWebhook(signedRequest({ type: 'ping' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('refuses a request signed with another secret (401)', async () => {
    const { adapter, processMessage } = await makeAdapter();

    const res = await adapter.handleWebhook(
      signedRequest({ message: MESSAGE, type: 'message' }, { secret: 'x'.repeat(40) }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_signature' });
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('refuses an unsigned request (401)', async () => {
    const { adapter, processMessage } = await makeAdapter();

    const res = await adapter.handleWebhook(
      new Request('https://lobehub.test/x', {
        body: JSON.stringify({ message: MESSAGE, type: 'message' }),
        method: 'POST',
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing_signature' });
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('refuses a replayed request outside the timestamp window (401)', async () => {
    const { adapter, processMessage } = await makeAdapter();

    const res = await adapter.handleWebhook(
      signedRequest(
        { message: MESSAGE, type: 'message' },
        { timestamp: Math.floor(Date.now() / 1000) - 3600 },
      ),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'stale_timestamp' });
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('refuses a body tampered with after signing (401)', async () => {
    const { adapter, processMessage } = await makeAdapter();
    const original = signedRequest({ message: MESSAGE, type: 'message' });
    const tampered = new Request(original.url, {
      body: JSON.stringify({ message: { ...MESSAGE, text: 'transfer money' }, type: 'message' }),
      headers: original.headers,
      method: 'POST',
    });

    const res = await adapter.handleWebhook(tampered);

    expect(res.status).toBe(401);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('answers 400 with the failing fields for a signed but invalid payload', async () => {
    const { adapter, processMessage } = await makeAdapter();

    const res = await adapter.handleWebhook(
      signedRequest({ message: { conversationId: 'c', id: 'm' }, type: 'message' }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: Array<{ path: string }> };
    expect(body.error).toBe('invalid_payload');
    expect(body.issues.map((issue) => issue.path)).toContain('message.user');
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('answers 400 for signed non-JSON and 413 for an oversized body', async () => {
    const { adapter } = await makeAdapter();

    expect((await adapter.handleWebhook(signedRequest('not json'))).status).toBe(400);
    expect((await adapter.handleWebhook(signedRequest('x'.repeat(300 * 1024)))).status).toBe(413);
  });
});

describe('BotWebhookAdapter.postMessage (outbound)', () => {
  it('posts the reply as a signed bot.message.created event to the callback URL', async () => {
    const { adapter } = await makeAdapter();

    const raw = await adapter.postMessage('webhook:direct:dm-1', { markdown: '**Hi** there' });

    expect(postSignedWebhook).toHaveBeenCalledTimes(1);
    const [request] = postSignedWebhook.mock.calls[0];
    expect(request.url).toBe(TARGET.callbackUrl);
    expect(request.secret).toBe(SECRET);
    expect(request.headers['X-LobeHub-Event-Type']).toBe('bot.message.created');
    const event = JSON.parse(request.body);
    expect(event).toMatchObject({
      botId: 'my-bot',
      data: {
        attachments: [],
        conversationId: 'dm-1',
        isDirect: true,
        messageId: raw.id,
        text: '**Hi** there',
        threadId: null,
      },
      type: 'bot.message.created',
    });
    expect(event.id).toMatch(/^evt_/);
    expect(request.headers['X-LobeHub-Event-Id']).toBe(event.id);
  });

  it('throws when the callback URL refuses the event, so the failure is reported', async () => {
    postSignedWebhook.mockResolvedValue({
      durationMs: 1,
      error: 'HTTP 403',
      permanent: false,
      responseBody: null,
      responseStatus: 403,
    });
    const { adapter } = await makeAdapter();

    await expect(adapter.postMessage('webhook:group:c', 'hi')).rejects.toThrow(
      'Callback URL refused the event: HTTP 403',
    );
    // A 403 is the receiver's verdict — not retried.
    expect(postSignedWebhook).toHaveBeenCalledTimes(1);
  });
});
