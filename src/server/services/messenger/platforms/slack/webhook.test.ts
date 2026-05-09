// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { slackWebhookGate } from './webhook';

const mockMarkRevoked = vi.fn();

vi.mock('../../installations', () => ({
  getInstallationStore: vi.fn(() => ({
    markRevoked: mockMarkRevoked,
  })),
}));

const mockVerifySignature = vi.fn();
vi.mock('../../oauth/slackOAuth', () => ({
  verifySignature: (...args: any[]) => mockVerifySignature(...args),
}));

vi.mock('@/config/messenger', () => ({
  getMessengerSlackConfig: vi.fn().mockReturnValue({
    appId: 'A_APP',
    clientId: 'cid',
    clientSecret: 'csecret',
    signingSecret: 'sigsec',
  }),
}));

const buildSlackRequest = (body: string, headers: Record<string, string> = {}): Request =>
  new Request('https://app.example.com/api/agent/messenger/webhooks/slack', {
    body,
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-slack-signature': 'v0=valid',
      ...headers,
    },
    method: 'POST',
  });

const ctx = () => ({ invalidateBot: vi.fn() });

beforeEach(() => {
  mockVerifySignature.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('slackWebhookGate.preprocess', () => {
  it('returns 401 when signature headers are missing', async () => {
    const req = new Request('https://e.com/x', { body: '{}', method: 'POST' });
    const res = await slackWebhookGate.preprocess(req, '{}', ctx());
    expect(res?.status).toBe(401);
    expect(mockVerifySignature).not.toHaveBeenCalled();
  });

  it('returns 401 when signature is invalid', async () => {
    mockVerifySignature.mockReturnValue(false);
    const res = await slackWebhookGate.preprocess(buildSlackRequest('{}'), '{}', ctx());
    expect(res?.status).toBe(401);
  });

  it('replies to url_verification with the challenge value', async () => {
    const body = JSON.stringify({ challenge: 'abc123', type: 'url_verification' });
    const res = await slackWebhookGate.preprocess(buildSlackRequest(body), body, ctx());
    expect(res?.status).toBe(200);
    expect(await res!.text()).toBe('abc123');
  });

  it('marks the install revoked + invalidates cached bot on app_uninstalled', async () => {
    const body = JSON.stringify({
      authorizations: [{ team_id: 'T_ACME' }],
      event: { type: 'app_uninstalled' },
      type: 'event_callback',
    });
    const c = ctx();
    const res = await slackWebhookGate.preprocess(buildSlackRequest(body), body, c);
    expect(res?.status).toBe(200);
    expect(mockMarkRevoked).toHaveBeenCalledWith('slack:T_ACME');
    expect(c.invalidateBot).toHaveBeenCalledWith('slack:T_ACME');
  });

  it('marks the install revoked on tokens_revoked too', async () => {
    const body = JSON.stringify({
      authorizations: [{ team_id: 'T_ACME' }],
      event: { type: 'tokens_revoked' },
      type: 'event_callback',
    });
    await slackWebhookGate.preprocess(buildSlackRequest(body), body, ctx());
    expect(mockMarkRevoked).toHaveBeenCalledWith('slack:T_ACME');
  });

  it('uses enterprise_id for grid org installs', async () => {
    const body = JSON.stringify({
      authorizations: [{ enterprise_id: 'E_GRID', is_enterprise_install: true }],
      event: { type: 'app_uninstalled' },
      type: 'event_callback',
    });
    await slackWebhookGate.preprocess(buildSlackRequest(body), body, ctx());
    expect(mockMarkRevoked).toHaveBeenCalledWith('slack:E_GRID');
  });

  it('returns null when the inbound is a normal message (caller continues)', async () => {
    const body = JSON.stringify({
      authorizations: [{ team_id: 'T_ACME' }],
      event: { type: 'message' },
      type: 'event_callback',
    });
    const res = await slackWebhookGate.preprocess(buildSlackRequest(body), body, ctx());
    expect(res).toBeNull();
    expect(mockMarkRevoked).not.toHaveBeenCalled();
  });
});
