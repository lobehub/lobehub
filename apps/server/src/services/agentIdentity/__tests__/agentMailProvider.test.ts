import { createInMemoryLinqWebhookDedupeStore } from '@lobechat/agent-address-linq';
import type { EmailMessageDetail } from '@lobechat/agent-address-mail';
import { computeAgentMailSignature } from '@lobechat/agent-address-mail';
import type { AgentAccountRef } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { createAgentMailProvider } from '../providers/agentMail';

/** A claim store of its own, so one test's accepted ids never leak into the next. */
const isolated = () => ({ dedupeStore: createInMemoryLinqWebhookDedupeStore() });

const SECRET = 'whsec_mail_secret';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

const mailDetail = (overrides: Partial<EmailMessageDetail> = {}): EmailMessageDetail => ({
  attachments: [],
  bcc: [],
  cc: [],
  codes: [],
  direction: 'inbound',
  envelope: { from: 'human@example.com', to: 'agent-7@lobe.id' },
  error: null,
  from: { address: 'human@example.com', name: 'Human' },
  html: null,
  id: 'msg_in_1',
  inboxId: 'inb_1',
  inReplyTo: null,
  links: [],
  messageId: '<m1@example.com>',
  read: false,
  receivedAt: '2026-10-02T00:00:00.000Z',
  references: ['<root@example.com>'],
  replyTo: [],
  size: 42,
  snippet: null,
  status: 'received',
  subject: 'Hello',
  text: 'the answer',
  to: [{ address: 'agent-7@lobe.id' }],
  ...overrides,
});

/** Minimal stand-in for the Agent Mail REST surface the provider touches. */
const createMailFetch = (options: { raw?: null | string } = {}) => {
  const calls: Array<{ body?: unknown; method: string; path: string }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const { pathname } = new URL(url);
    calls.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      method,
      path: pathname,
    });

    if (method === 'POST' && pathname === '/v1/inboxes') {
      return json({ address: 'agent-7@lobe.id', clientId: 'cli_1', id: 'inb_1', metadata: {} });
    }
    if (method === 'POST' && pathname === '/v1/webhooks') {
      return json({ id: 'wh_1', secret: SECRET, url: 'https://app.lobehub.com/hook' });
    }
    if (method === 'DELETE' && pathname === '/v1/inboxes/inb_1') {
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && pathname === '/v1/inboxes/inb_1/messages') {
      return json(mailDetail({ direction: 'outbound', id: 'msg_out_1' }));
    }
    if (method === 'POST' && pathname === '/v1/messages/msg_in_1/reply') {
      return json(mailDetail({ direction: 'outbound', id: 'msg_out_reply_1' }));
    }
    if (method === 'GET' && pathname === '/v1/messages/msg_in_1') {
      return json(mailDetail());
    }
    if (method === 'GET' && pathname === '/v1/messages/msg_in_1/raw') {
      if (options.raw === null) return new Response('', { status: 404 });
      return new Response(options.raw ?? 'From: human@example.com\r\nSubject: Hello\r\n\r\nbody');
    }

    throw new Error(`unexpected mail request ${method} ${pathname}`);
  };

  return { calls, fetchImpl };
};

const inboundBody = (address = 'agent-7@lobe.id', messageId = 'msg_in_1') =>
  JSON.stringify({
    createdAt: '2026-10-02T00:00:00.000Z',
    data: {
      inbox: { address, clientId: 'cli_1', id: 'inb_1' },
      message: { id: messageId },
    },
    id: 'evt_1',
    type: 'message.received',
  });

const ref = (overrides: Partial<AgentAccountRef> = {}): AgentAccountRef => ({
  credential: { webhookSecret: SECRET },
  id: 'acc_1',
  identifier: 'agent-7@lobe.id',
  kind: 'mail',
  metadata: { inboxId: 'inb_1' },
  provider: 'agent-mail',
  ...overrides,
});

describe('agent-mail provider — declaration', () => {
  it('declares the mail identity it issues and what it can do', () => {
    const provider = createAgentMailProvider({ ...isolated(), apiKey: 'am_test' });

    expect(provider.provider).toBe('agent-mail');
    expect(provider.kind).toBe('mail');
    expect(provider.capabilities).toEqual({ receive: true, send: true });
  });
});

describe('agent-mail provider — provisioning', () => {
  it('deletes the inbox it just opened when webhook registration fails', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const { pathname } = new URL(typeof input === 'string' ? input : input.toString());
      const method = init?.method ?? 'GET';
      calls.push({ method, path: pathname });
      if (method === 'POST' && pathname === '/v1/inboxes')
        return json({ address: 'agent-7@lobe.id', clientId: 'cli_1', id: 'inb_1', metadata: {} });
      if (method === 'POST' && pathname === '/v1/webhooks')
        return json({ error: { message: 'upstream unavailable' } }, 503);
      if (method === 'DELETE' && pathname === '/v1/inboxes/inb_1')
        return new Response(null, { status: 204 });
      throw new Error(`unexpected ${method} ${pathname}`);
    };
    const provider = createAgentMailProvider({
      ...isolated(),
      apiKey: 'am_test',
      fetchImpl,
      webhookUrl: 'https://app.lobehub.com/hook',
    });

    await expect(provider.provision({ agentId: 'agent_7', userId: 'user_1' })).rejects.toThrow(
      /503/,
    );
    expect(calls).toContainEqual({ method: 'DELETE', path: '/v1/inboxes/inb_1' });
  });

  it('opens an inbox and stores the returned handle as the identifier', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const provider = createAgentMailProvider({ ...isolated(), apiKey: 'am_test', fetchImpl });

    const result = await provider.provision({ agentId: 'agent_7', userId: 'user_1' });

    expect(result.identifier).toBe('agent-7@lobe.id');
    expect(result.metadata).toEqual({ clientId: 'cli_1', inboxId: 'inb_1' });
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/inboxes')).toBe(true);
  });

  it('registers the webhook and returns its one-time secret as the credential', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const provider = createAgentMailProvider({
      apiKey: 'am_test',
      fetchImpl,
      webhookUrl: 'https://app.lobehub.com/hook',
    });

    const result = await provider.provision({ agentId: 'agent_7', userId: 'user_1' });

    expect(result.credential).toEqual({ webhookSecret: SECRET });
    expect(result.credentialHint?.masked).toBe('••••cret');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/webhooks')).toBe(true);
  });

  it('releases the inbox on release', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const provider = createAgentMailProvider({ ...isolated(), apiKey: 'am_test', fetchImpl });

    await provider.release(ref());

    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'DELETE', path: '/v1/inboxes/inb_1' }),
    );
  });

  it('treats an inbox that is already gone as released', async () => {
    const fetchImpl: typeof fetch = async () =>
      json({ error: { code: 'not_found', message: 'Inbox not found' } }, 404);
    const provider = createAgentMailProvider({ ...isolated(), apiKey: 'am_test', fetchImpl });

    await expect(provider.release(ref())).resolves.toBeUndefined();
  });

  it('still surfaces a release the provider actually refused', async () => {
    const fetchImpl: typeof fetch = async () => json({ error: { message: 'boom' } }, 500);
    const provider = createAgentMailProvider({ ...isolated(), apiKey: 'am_test', fetchImpl });

    await expect(provider.release(ref())).rejects.toThrow(/500/);
  });
});

describe('agent-mail provider — inbound', () => {
  it('routes a delivery by the inbox address in its payload', () => {
    const provider = createAgentMailProvider({ ...isolated(), apiKey: 'am_test' });

    expect(provider.resolveInboundIdentifier({ body: inboundBody(), headers: {} })).toBe(
      'agent-7@lobe.id',
    );
    expect(provider.resolveInboundIdentifier({ body: 'not json', headers: {} })).toBeUndefined();
  });

  it('accepts a correctly signed delivery and rejects a forged one', async () => {
    const provider = createAgentMailProvider({ ...isolated(), apiKey: 'am_test' });
    const body = inboundBody();
    const timestamp = Math.floor(Date.now() / 1000);

    const accepted = await provider.verifyInbound(
      {
        body,
        headers: { 'x-agentmail-signature': computeAgentMailSignature(SECRET, body, timestamp) },
      },
      ref(),
    );
    expect(accepted).toEqual({
      eventId: 'evt_1',
      payload: expect.objectContaining({ id: 'evt_1' }),
    });

    const forged = await provider.verifyInbound(
      {
        body,
        headers: {
          'x-agentmail-signature': computeAgentMailSignature('wrong_secret', body, timestamp),
        },
      },
      ref(),
    );
    expect(forged).toBeNull();
  });

  it('flags a replay of an event it already accepted as a duplicate', async () => {
    const provider = createAgentMailProvider({ ...isolated(), apiKey: 'am_test' });
    const body = inboundBody();
    const headers = {
      'x-agentmail-signature': computeAgentMailSignature(
        SECRET,
        body,
        Math.floor(Date.now() / 1000),
      ),
    };

    await expect(provider.verifyInbound({ body, headers }, ref())).resolves.toEqual(
      expect.objectContaining({ eventId: 'evt_1' }),
    );
    await expect(provider.verifyInbound({ body, headers }, ref())).resolves.toEqual(
      expect.objectContaining({ duplicate: true }),
    );
  });

  it('remembers an accepted event across provider instances, as each webhook request builds one', async () => {
    const body = inboundBody('agent-7@lobe.id', 'msg_in_1').replace('evt_1', 'evt_cross_instance');
    const headers = {
      'x-agentmail-signature': computeAgentMailSignature(
        SECRET,
        body,
        Math.floor(Date.now() / 1000),
      ),
    };

    const firstRequest = createAgentMailProvider({ apiKey: 'am_test' });
    const secondRequest = createAgentMailProvider({ apiKey: 'am_test' });

    await expect(firstRequest.verifyInbound({ body, headers }, ref())).resolves.toEqual(
      expect.objectContaining({ eventId: 'evt_cross_instance' }),
    );
    await expect(secondRequest.verifyInbound({ body, headers }, ref())).resolves.toEqual(
      expect.objectContaining({ duplicate: true }),
    );
  });

  it('falls back to the shared secret when the account carries none', async () => {
    const provider = createAgentMailProvider({
      ...isolated(),
      apiKey: 'am_test',
      webhookSecret: SECRET,
    });
    const body = inboundBody();
    const timestamp = Math.floor(Date.now() / 1000);

    await expect(
      provider.verifyInbound(
        {
          body,
          headers: { 'x-agentmail-signature': computeAgentMailSignature(SECRET, body, timestamp) },
        },
        ref({ credential: null }),
      ),
    ).resolves.toEqual(expect.objectContaining({ eventId: 'evt_1' }));
  });

  it('processes a retry after the message fetch failed instead of dropping it', async () => {
    let detailAttempts = 0;
    const { fetchImpl: base } = createMailFetch();
    const fetchImpl: typeof fetch = async (input, init) => {
      const { pathname } = new URL(typeof input === 'string' ? input : input.toString());
      if (pathname === '/v1/messages/msg_in_1' && ++detailAttempts === 1)
        return json({ error: { message: 'temporarily unavailable' } }, 503);
      return base(input, init);
    };
    const provider = createAgentMailProvider({ ...isolated(), apiKey: 'am_test', fetchImpl });
    const body = inboundBody();
    const request = {
      body,
      headers: {
        'x-agentmail-signature': computeAgentMailSignature(
          SECRET,
          body,
          Math.floor(Date.now() / 1000),
        ),
      },
    };

    const first = await provider.verifyInbound(request, ref());
    await expect(provider.normalizeInbound(first!, ref())).rejects.toThrow(/503/);

    // The provider retries the same event: it must be processed, not acked as a duplicate.
    const retry = await provider.verifyInbound(request, ref());
    expect(retry).not.toHaveProperty('duplicate', true);
    await expect(provider.normalizeInbound(retry!, ref())).resolves.toMatchObject({
      providerMessageId: 'msg_in_1',
    });
  });

  it('normalizes a message, stripping the quoted history', async () => {
    const { fetchImpl } = createMailFetch();
    const provider = createAgentMailProvider({ ...isolated(), apiKey: 'am_test', fetchImpl });

    const message = await provider.normalizeInbound(
      { eventId: 'evt_1', payload: JSON.parse(inboundBody()) },
      ref(),
    );

    expect(message).toMatchObject({
      from: 'human@example.com',
      providerMessageId: 'msg_in_1',
      subject: 'Hello',
      threadKey: '<root@example.com>',
      to: 'agent-7@lobe.id',
    });
    expect(message!.text).toContain('the answer');
  });

  it('drops robot mail instead of handing it to the agent', async () => {
    const { fetchImpl } = createMailFetch({
      raw: 'From: human@example.com\r\nSubject: Hello\r\nAuto-Submitted: auto-replied\r\n\r\nx',
    });
    const provider = createAgentMailProvider({ ...isolated(), apiKey: 'am_test', fetchImpl });

    const message = await provider.normalizeInbound(
      { eventId: 'evt_1', payload: JSON.parse(inboundBody()) },
      ref(),
    );

    expect(message).toBeNull();
  });
});

describe('agent-mail provider — outbound', () => {
  it('sends through the inbox and returns the provider message id', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const provider = createAgentMailProvider({ apiKey: 'am_test', fetchImpl });

    const result = await provider.send(ref(), {
      subject: 'Re: Hello',
      text: 'hi back',
      to: 'human@example.com',
    });

    expect(result).toEqual({ providerMessageId: 'msg_out_1' });
    const send = calls.find((c) => c.method === 'POST' && c.path === '/v1/inboxes/inb_1/messages');
    expect(send?.body).toMatchObject({
      html: '<p>hi back</p>',
      subject: 'Re: Hello',
      text: 'hi back',
      to: 'human@example.com',
    });
  });

  it('renders the agent Markdown into an HTML part plus a plain-text alternative', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const provider = createAgentMailProvider({ apiKey: 'am_test', fetchImpl });

    await provider.send(ref(), {
      subject: 'Brief',
      text: '**Done.** See [the docs](https://lobehub.com/docs)\n\n1. one\n2. two',
      to: 'human@example.com',
    });

    const send = calls.find((c) => c.method === 'POST' && c.path === '/v1/inboxes/inb_1/messages');
    const body = send?.body as undefined | { html?: string; text?: string };
    expect(body?.html).toContain('<strong>Done.</strong>');
    expect(body?.html).toContain('<a href="https://lobehub.com/docs"');
    expect(body?.html).toContain('<ol><li>one</li><li>two</li></ol>');
    expect(body?.html).not.toContain('**');
    expect(body?.text).toBe('Done. See the docs (https://lobehub.com/docs)\n\n- one\n- two');
    expect(body?.text).not.toContain('**');
  });

  it('answers within the thread when the caller names the message it replies to', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const provider = createAgentMailProvider({ apiKey: 'am_test', fetchImpl });

    const result = await provider.send(ref(), {
      replyToProviderMessageId: 'msg_in_1',
      text: 'hi back',
      to: 'human@example.com',
    });

    // The reply route inherits the recipients and threads the message; going
    // through `sendMessage` would start a second conversation with the same
    // subject instead of answering the human in theirs.
    expect(calls.filter((call) => call.method === 'POST')).toEqual([
      { body: { text: 'hi back' }, method: 'POST', path: '/v1/messages/msg_in_1/reply' },
    ]);
    expect(result).toEqual({ providerMessageId: 'msg_out_reply_1' });
  });
});
