// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/agentIdentity/inbound', () => ({
  createAgentInboundService: vi.fn(async () => ({ handle })),
}));

const { AGENT_ACCOUNT_WEBHOOK_MAX_BYTES, agentAccountWebhook, agentAccountWebhookBodyLimit } =
  await import('../agentAccountWebhook');

const app = new Hono().post(
  '/accounts/webhooks/:provider',
  agentAccountWebhookBodyLimit,
  agentAccountWebhook,
);

beforeEach(() => {
  vi.clearAllMocks();
  handle.mockResolvedValue({ outcome: 'unknown-account', status: 404 });
});

describe('agent account webhook — body cap', () => {
  it('refuses an oversized delivery before anything reads or verifies it', async () => {
    const res = await app.request('/accounts/webhooks/agent-mail', {
      body: 'x'.repeat(AGENT_ACCOUNT_WEBHOOK_MAX_BYTES + 1),
      method: 'POST',
    });

    expect(res.status).toBe(413);
    expect(handle).not.toHaveBeenCalled();
  });

  it('cuts off a stream with no declared length at the cap', async () => {
    const chunk = new TextEncoder().encode('y'.repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Endless unless the server stops reading.
        sent += chunk.byteLength;
        controller.enqueue(chunk);
        if (sent > AGENT_ACCOUNT_WEBHOOK_MAX_BYTES * 4) controller.close();
      },
    });

    const res = await app.request('/accounts/webhooks/agent-mail', {
      body: stream,
      // @ts-expect-error -- Node's fetch needs duplex for a streamed request body
      duplex: 'half',
      method: 'POST',
    });

    expect(res.status).toBe(413);
    expect(handle).not.toHaveBeenCalled();
  });

  it('passes a normal delivery through to the inbound service unchanged', async () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'message.received' });

    const res = await app.request('/accounts/webhooks/agent-mail', { body, method: 'POST' });

    expect(res.status).toBe(404);
    expect(handle).toHaveBeenCalledWith('agent-mail', expect.objectContaining({ body }));
  });
});
