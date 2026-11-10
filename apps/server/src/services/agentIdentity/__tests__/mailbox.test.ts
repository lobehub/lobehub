// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentMailPurgeTarget } from '@/database/models/agentMail';

import { AgentAccountError } from '../errors';
import { createAgentMailProvider } from '../providers/agentMail';

const model = vi.hoisted(() => ({
  claimForPurge: vi.fn(async (ids: string[]) => ids),
  findById: vi.fn(),
  findLatestInboundInThread: vi.fn(),
  purge: vi.fn(async (ids: string[]) => ids.length),
  releasePurge: vi.fn(async (_ids: string[]) => {}),
}));
vi.mock('@/database/models/agentMail', () => ({
  AgentMailModel: vi.fn(function () {
    return model;
  }),
}));

const drafts = vi.hoisted(() => ({
  claimForSend: vi.fn(),
  delete: vi.fn(async () => 1),
  findById: vi.fn(),
  releaseSend: vi.fn(async () => {}),
}));
vi.mock('@/database/models/agentMailDraft', () => ({
  AgentMailDraftModel: vi.fn(function () {
    return drafts;
  }),
}));

const recordSentMail = vi.hoisted(() => vi.fn(async (_p: any) => ({ mail: { id: 'mail_sent' } })));
vi.mock('../inbox', () => ({
  AgentInboxService: vi.fn(function () {
    return { recordSentMail };
  }),
}));

const { AgentMailboxService } = await import('../mailbox');

const account = {
  agentId: 'agt',
  capabilities: { receive: true, send: true },
  id: 'acc',
  identifier: 'agent@lobe.id',
  metadata: { inboxId: 'inbox_1' },
  provider: 'agent-mail',
  status: 'active',
};

const source = {
  accountId: 'acc',
  cc: [{ address: 'carol@x.io' }, { address: 'agent@lobe.id' }],
  direction: 'inbound',
  fromAddress: 'alice@x.io',
  fromName: 'Alice',
  id: 'mail_src',
  messageId: '<source@x.io>',
  providerMessageId: 'prov_src',
  references: ['<root@x.io>'],
  replyTo: [],
  subject: 'Hello',
  text: 'original words',
  threadKey: '<root@x.io>',
  to: [{ address: 'agent@lobe.id' }, { address: 'bob@x.io' }],
};

type Call = { body?: any; method: string; path: string };
let calls: Call[] = [];
let replyResponse: { body: unknown; status: number } | undefined;

/** The real provider over a fake lobe.id, so assertions see the actual request. */
const defaultFetch = async (url: string | URL, init?: RequestInit) => {
  const path = String(url).replace('https://api.test', '');
  const method = init?.method ?? 'GET';
  calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined, method, path });

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (method === 'GET' && path === '/v1/messages/prov_src') {
    return json({
      attachments: [{ contentType: 'text/plain', filename: 'a.txt', index: 0, size: 1 }],
      id: 'prov_src',
      inboxId: 'inbox_1',
    });
  }
  if (path.endsWith('/attachments/0')) return new Response('bytes');
  if (path.endsWith('/reply')) {
    if (replyResponse) return json(replyResponse.body, replyResponse.status);
    return json({
      id: 'prov_new',
      inReplyTo: '<source@x.io>',
      messageId: '<new@lobe.id>',
      references: ['<root@x.io>', '<source@x.io>'],
    });
  }
  if (method === 'POST') {
    return replyResponse
      ? json(replyResponse.body, replyResponse.status)
      : json({ id: 'prov_new', messageId: '<new@lobe.id>', references: [] });
  }
  return json({ error: { code: 'not_found' } }, 404);
};
const fetchImpl = vi.fn(defaultFetch);

const provider = createAgentMailProvider({
  apiBaseUrl: 'https://api.test',
  apiKey: 'am_test',
  fetchImpl: fetchImpl as unknown as typeof fetch,
});

const accounts = {
  deleteProviderMessage: vi.fn(async (_accountId: string, _id: string) => {}),
  get: vi.fn(async () => account as any),
  send: vi.fn((_id: string, message: any) => provider.send(account as any, message)),
};

const service = () =>
  new AgentMailboxService({} as any, 'user', { accounts: accounts as any, workspaceId: 'ws' });

const expectRefusal = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.catch((error_: unknown) => error_);
  expect(error).toBeInstanceOf(AgentAccountError);
  expect((error as AgentAccountError).code).toBe(code);
  expect((error as AgentAccountError).data).toEqual({ code });
  return error as AgentAccountError;
};

const compose = {
  accountId: 'acc',
  mode: 'compose' as const,
  subject: 'Hi',
  text: 'hello',
  to: [{ address: 'bob@x.io' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  replyResponse = undefined;
  accounts.get.mockResolvedValue(account);
  model.findById.mockResolvedValue(source);
  drafts.delete.mockResolvedValue(1);
});

describe('send', () => {
  it('writes a new mail through the account service and files it under Sent', async () => {
    const result = await service().send({
      ...compose,
      bcc: [{ address: 'b@x.io' }],
      cc: [{ address: 'c@x.io' }],
      to: [{ address: 'bob@x.io' }, { address: 'dan@x.io' }],
    });

    expect(accounts.send).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({
      body: { bcc: ['b@x.io'], cc: ['c@x.io'], subject: 'Hi', to: ['bob@x.io', 'dan@x.io'] },
      method: 'POST',
      path: '/v1/inboxes/inbox_1/messages',
    });
    expect(recordSentMail.mock.calls[0][0]).toMatchObject({
      bcc: [{ address: 'b@x.io' }],
      cc: [{ address: 'c@x.io' }],
      providerMessageId: 'prov_new',
      threadKey: '<new@lobe.id>',
    });
    expect(result).toEqual({ mailId: 'mail_sent', providerMessageId: 'prov_new' });
  });

  it('replies through the threading route and records In-Reply-To and References', async () => {
    await service().send({
      accountId: 'acc',
      mode: 'reply',
      sourceMailId: 'mail_src',
      text: 'thanks',
    });

    const reply = calls.find((call) => call.path.endsWith('/reply'))!;
    expect(reply.path).toBe('/v1/messages/prov_src/reply');
    expect(reply.body.replyAll).toBeUndefined();
    expect(recordSentMail.mock.calls[0][0]).toMatchObject({
      inReplyTo: '<source@x.io>',
      messageId: '<new@lobe.id>',
      references: ['<root@x.io>', '<source@x.io>'],
      subject: 'Re: Hello',
      threadKey: '<root@x.io>',
      to: [{ address: 'alice@x.io' }],
    });
  });

  it('accumulates References itself when the provider reports none', async () => {
    replyResponse = { body: { id: 'prov_new', messageId: '<n@x>' }, status: 200 };

    await service().send({ accountId: 'acc', mode: 'reply', sourceMailId: 'mail_src', text: 'x' });

    expect(recordSentMail.mock.calls[0][0]).toMatchObject({
      inReplyTo: '<source@x.io>',
      references: ['<root@x.io>', '<source@x.io>'],
    });
  });

  it('reply-all asks the provider for it and records everyone but itself', async () => {
    await service().send({
      accountId: 'acc',
      mode: 'replyAll',
      sourceMailId: 'mail_src',
      text: 'all',
    });

    expect(calls.find((call) => call.path.endsWith('/reply'))!.body.replyAll).toBe(true);
    expect(recordSentMail.mock.calls[0][0].cc).toEqual([
      { address: 'bob@x.io' },
      { address: 'carol@x.io' },
    ]);
  });

  it('honours Reply-To when recording who a reply went to', async () => {
    model.findById.mockResolvedValue({ ...source, replyTo: [{ address: 'desk@x.io' }] });

    await service().send({ accountId: 'acc', mode: 'reply', sourceMailId: 'mail_src', text: 'x' });

    expect(recordSentMail.mock.calls[0][0].to).toEqual([{ address: 'desk@x.io' }]);
  });

  it('answers the latest received mail when the picked one was sent', async () => {
    model.findById.mockResolvedValue({ ...source, direction: 'outbound', id: 'mine' });
    model.findLatestInboundInThread.mockResolvedValue(source);

    await service().send({ accountId: 'acc', mode: 'reply', sourceMailId: 'mine', text: 'x' });

    expect(calls.find((call) => call.path.endsWith('/reply'))!.path).toBe(
      '/v1/messages/prov_src/reply',
    );
  });

  it('forwards as a new conversation, with the quote, attachments and origin headers', async () => {
    await service().send({
      accountId: 'acc',
      mode: 'forward',
      sourceMailId: 'mail_src',
      text: 'fyi',
      to: [{ address: 'eve@x.io' }],
    });

    const send = calls.find((call) => call.path === '/v1/inboxes/inbox_1/messages')!;
    expect(send.body.subject).toBe('Fwd: Hello');
    expect(send.body.text).toContain('original words');
    expect(send.body.attachments).toEqual([
      {
        content: Buffer.from('bytes').toString('base64'),
        contentType: 'text/plain',
        filename: 'a.txt',
      },
    ]);
    expect(recordSentMail.mock.calls[0][0]).toMatchObject({
      attachments: [{ contentType: 'text/plain', filename: 'a.txt', index: 0, size: 5 }],
      inReplyTo: '<source@x.io>',
      references: ['<root@x.io>', '<source@x.io>'],
      threadKey: '<new@lobe.id>',
    });
  });

  it('fails the forward, sending nothing, when an attachment fails to download', async () => {
    fetchImpl.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace('https://api.test', '');
      calls.push({ method: init?.method ?? 'GET', path });
      if (path === '/v1/messages/prov_src') {
        return new Response(
          JSON.stringify({ attachments: [{ filename: 'a.txt', index: 0 }], inboxId: 'inbox_1' }),
        );
      }
      if (path.endsWith('/attachments/0')) return new Response('down', { status: 503 });
      return new Response(JSON.stringify({ id: 'prov_new' }));
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expectRefusal(
      service().send({
        accountId: 'acc',
        mode: 'forward',
        sourceMailId: 'mail_src',
        text: 'fyi',
        to: [{ address: 'eve@x.io' }],
      }),
      'send_failed',
    );

    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(recordSentMail).not.toHaveBeenCalled();
    fetchImpl.mockImplementation(defaultFetch);
    consoleError.mockRestore();
  });

  it('forwards without an attachment the provider no longer holds', async () => {
    fetchImpl.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace('https://api.test', '');
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ body, method: init?.method ?? 'GET', path });
      if (path === '/v1/messages/prov_src') {
        return new Response(
          JSON.stringify({ attachments: [{ filename: 'a.txt', index: 0 }], inboxId: 'inbox_1' }),
        );
      }
      if (path.endsWith('/attachments/0')) return new Response('gone', { status: 404 });
      return new Response(JSON.stringify({ id: 'prov_new', messageId: '<n@x>' }));
    });

    await service().send({
      accountId: 'acc',
      mode: 'forward',
      sourceMailId: 'mail_src',
      text: 'fyi',
      to: [{ address: 'eve@x.io' }],
    });

    expect(calls.find((call) => call.method === 'POST')?.body.attachments).toEqual([]);
    fetchImpl.mockImplementation(defaultFetch);
  });

  it('still reports a sent mail when recording it fails', async () => {
    recordSentMail.mockRejectedValueOnce(new Error('db down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(service().send(compose)).resolves.toMatchObject({ mailId: undefined });
    consoleError.mockRestore();
  });
});

describe('refusals', () => {
  it('names a receive-only address before reaching the provider', async () => {
    accounts.get.mockResolvedValue({
      ...account,
      capabilities: { receive: true, send: false },
    });

    const error = await expectRefusal(service().send(compose), 'send_disabled');

    expect(error.message).toBe('This address can only receive mail. Upgrade to send.');
    expect(accounts.send).not.toHaveBeenCalled();
  });

  it.each([
    [402, 'upgrade_required', 'send_disabled'],
    [402, 'end_user_send_disabled', 'send_disabled'],
    [429, 'end_user_send_limit_reached', 'send_limit_daily'],
    [429, 'inbox_rate_limited', 'send_limit_hourly'],
    [403, 'end_user_suspended', 'send_suspended'],
    [422, 'send_rejected', 'send_rejected'],
    [500, 'boom', 'send_failed'],
  ])('maps a provider %i %s to %s', async (status, code, expected) => {
    replyResponse = { body: { error: { code, message: 'upstream said no' } }, status };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expectRefusal(service().send(compose), expected);

    expect(recordSentMail).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('refuses a released address', async () => {
    accounts.get.mockResolvedValue({ ...account, status: 'revoked' });
    await expectRefusal(service().send(compose), 'account_unavailable');
  });

  it('refuses an account outside the scope', async () => {
    accounts.get.mockResolvedValue(undefined);
    await expectRefusal(service().send(compose), 'account_not_found');
  });

  it('propagates the account service permission check without recording', async () => {
    accounts.send.mockRejectedValueOnce(
      new AgentAccountError('reply_target_not_owned', 'not yours'),
    );

    await expectRefusal(service().send(compose), 'reply_target_not_owned');
    expect(recordSentMail).not.toHaveBeenCalled();
  });

  it.each(['agent@lobe.id', 'AGENT@lobe.id', 'mailer-daemon@x.io', 'postmaster@x.io'])(
    'applies the loop guard to %s',
    async (address) => {
      await expectRefusal(service().send({ ...compose, to: [{ address }] }), 'recipient_looping');
      expect(accounts.send).not.toHaveBeenCalled();
    },
  );

  it('applies the loop guard to copies too', async () => {
    await expectRefusal(
      service().send({ ...compose, bcc: [{ address: 'agent@lobe.id' }] }),
      'recipient_looping',
    );
  });

  it('needs a recipient', async () => {
    await expectRefusal(service().send({ ...compose, to: [] }), 'recipients_required');
  });

  it('refuses a mail that is gone or belongs to another address', async () => {
    model.findById.mockResolvedValueOnce(undefined);
    await expectRefusal(
      service().send({ accountId: 'acc', mode: 'reply', sourceMailId: 'x', text: 'x' }),
      'reply_target_gone',
    );

    model.findById.mockResolvedValueOnce({ ...source, accountId: 'other' });
    await expectRefusal(
      service().send({ accountId: 'acc', mode: 'reply', sourceMailId: 'x', text: 'x' }),
      'reply_target_not_owned',
    );
  });
});

describe('sendDraft', () => {
  const draft = { ...compose, id: 'd', to: [{ address: 'bob@x.io' }], bcc: [], cc: [] };

  it('deletes the draft once sent', async () => {
    drafts.claimForSend.mockResolvedValue(draft);

    await service().sendDraft('d');

    expect(accounts.send).toHaveBeenCalledTimes(1);
    expect(drafts.delete).toHaveBeenCalledWith(['d']);
  });

  it('keeps the draft and frees the lease when sending fails', async () => {
    drafts.claimForSend.mockResolvedValue(draft);
    replyResponse = { body: { error: { code: 'upgrade_required' } }, status: 402 };

    await expectRefusal(service().sendDraft('d'), 'send_disabled');

    expect(drafts.delete).not.toHaveBeenCalled();
    expect(drafts.releaseSend).toHaveBeenCalledWith('d');
  });

  it('refuses a second submit while one is in flight', async () => {
    drafts.claimForSend.mockResolvedValue(undefined);
    drafts.findById.mockResolvedValue(draft);

    await expectRefusal(service().sendDraft('d'), 'draft_sending');
    expect(accounts.send).not.toHaveBeenCalled();
  });

  it('reports a draft that is gone', async () => {
    drafts.claimForSend.mockResolvedValue(undefined);
    drafts.findById.mockResolvedValue(undefined);

    await expectRefusal(service().sendDraft('d'), 'draft_not_found');
  });
});

describe('purge', () => {
  const target = (id: string): AgentMailPurgeTarget => ({
    accountId: 'acc',
    agentId: 'agt',
    id,
    providerMessageId: `prov_${id}`,
  });

  it('deletes the provider copy and then wipes the mail', async () => {
    const result = await service().purge([target('a'), target('b')]);

    expect(accounts.deleteProviderMessage).toHaveBeenCalledWith('acc', 'prov_a');
    expect(accounts.deleteProviderMessage).toHaveBeenCalledWith('acc', 'prov_b');
    expect(model.purge).toHaveBeenCalledWith(['a', 'b']);
    expect(result).toEqual({ count: 2, failed: 0 });
  });

  it('claims before the provider delete and skips what someone else restored', async () => {
    model.claimForPurge.mockResolvedValueOnce(['a']);

    const result = await service().purge([target('a'), target('b')]);

    expect(model.claimForPurge).toHaveBeenCalledWith(['a', 'b']);
    expect(accounts.deleteProviderMessage).toHaveBeenCalledTimes(1);
    expect(accounts.deleteProviderMessage).toHaveBeenCalledWith('acc', 'prov_a');
    expect(model.claimForPurge.mock.invocationCallOrder[0]).toBeLessThan(
      accounts.deleteProviderMessage.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({ count: 1, failed: 0 });
  });

  it('leaves a mail intact when its provider copy could not be deleted', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    accounts.deleteProviderMessage.mockImplementation(async (_accountId, id) => {
      if (id === 'prov_b') throw new Error('provider down');
    });

    const result = await service().purge([target('a'), target('b')]);

    expect(model.purge).toHaveBeenCalledWith(['a']);
    expect(model.releasePurge).toHaveBeenCalledWith(['b']);
    expect(result).toEqual({ count: 1, failed: 1 });
    accounts.deleteProviderMessage.mockReset();
    accounts.deleteProviderMessage.mockResolvedValue(undefined);
    consoleError.mockRestore();
  });
});

describe('provider.deleteMessage', () => {
  it('calls DELETE on lobe.id for a message in this inbox', async () => {
    fetchImpl.mockImplementationOnce(
      async () => new Response(JSON.stringify({ id: 'x', inboxId: 'inbox_1' })),
    );
    fetchImpl.mockImplementationOnce(async (url, init) => {
      calls.push({ method: init?.method ?? 'GET', path: String(url) });
      return new Response(null, { status: 204 });
    });

    await provider.deleteMessage!(account as any, 'x');

    expect(calls).toEqual([{ method: 'DELETE', path: 'https://api.test/v1/messages/x' }]);
  });

  it('never deletes a message from another inbox', async () => {
    fetchImpl.mockImplementationOnce(
      async () => new Response(JSON.stringify({ id: 'x', inboxId: 'someone_else' })),
    );

    await expect(provider.deleteMessage!(account as any, 'x')).rejects.toMatchObject({
      code: 'reply_target_not_owned',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats a message already gone as deleted', async () => {
    await expect(provider.deleteMessage!(account as any, 'gone')).resolves.toBeUndefined();
  });
});
