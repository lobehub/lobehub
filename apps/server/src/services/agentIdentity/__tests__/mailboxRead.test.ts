// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentAccountError } from '../errors';
import { createAgentMailProvider } from '../providers/agentMail';

const model = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('@/database/models/agentMail', () => ({
  AgentMailModel: vi.fn(function () {
    return model;
  }),
}));
vi.mock('@/database/models/agentMailDraft', () => ({ AgentMailDraftModel: vi.fn() }));
vi.mock('@/database/repositories/agentMailPurge', () => ({ AgentMailPurgeRepository: vi.fn() }));
vi.mock('../inbox', () => ({ AgentInboxService: vi.fn() }));

const { AgentMailboxService, MAX_ATTACHMENT_DOWNLOAD_BYTES } = await import('../mailbox');

const account = { identifier: 'agent@lobe.id', metadata: { inboxId: 'inbox_1' } };

const mail = {
  accountId: 'acc',
  attachments: [
    { contentType: 'text/html', filename: 'invoice.html', index: 0, size: 5 },
    { filename: 'huge.bin', index: 1, size: MAX_ATTACHMENT_DOWNLOAD_BYTES + 1 },
  ],
  id: 'mail_1',
  providerMessageId: 'prov_1',
};

let message: Record<string, unknown>;
let attachmentResponse: () => Response;
let paths: string[];

/** A fake lobe.id behind the real provider, so the ownership checks are the real ones. */
const fetchImpl = vi.fn(async (url: string | URL) => {
  const path = String(url).replace('https://api.test', '');
  paths.push(path);
  if (path === '/v1/messages/prov_1') return Response.json(message);
  if (path.startsWith('/v1/messages/prov_1/attachments/')) return attachmentResponse();
  return Response.json({ error: { code: 'not_found' } }, { status: 404 });
});

const provider = createAgentMailProvider({
  apiBaseUrl: 'https://api.test',
  apiKey: 'am_test',
  fetchImpl: fetchImpl as unknown as typeof fetch,
});

const accounts = {
  downloadProviderAttachment: vi.fn(
    (_accountId: string, id: string, index: number, options: { maxBytes: number }) =>
      provider.downloadAttachment!(account as any, id, index, options),
  ),
  getProviderMessageHtml: vi.fn((_accountId: string, id: string) =>
    provider.getMessageHtml!(account as any, id),
  ),
};

const service = () =>
  new AgentMailboxService({} as any, 'user', { accounts: accounts as any, workspaceId: 'ws' });

beforeEach(() => {
  vi.clearAllMocks();
  paths = [];
  message = { html: '<p onclick="x()">hi</p>', id: 'prov_1', inboxId: 'inbox_1' };
  attachmentResponse = () => new Response('bytes', { headers: { 'content-type': 'text/html' } });
  model.findById.mockResolvedValue(mail);
});

describe('readHtml', () => {
  it('returns the sanitized HTML of a mail in scope', async () => {
    expect(await service().readHtml('mail_1')).toEqual({
      hasRemoteContent: false,
      html: '<p>hi</p>',
      status: 'ok',
    });
  });

  it('asks no provider for a mail outside the caller scope', async () => {
    model.findById.mockResolvedValue(undefined);

    expect(await service().readHtml('mail_x')).toEqual({ status: 'expired' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never reads a message that lives in another inbox', async () => {
    message = { ...message, inboxId: 'inbox_other' };

    expect(await service().readHtml('mail_1')).toEqual({ status: 'expired' });
  });

  it('tells a mail without HTML from one the provider no longer holds', async () => {
    message = { ...message, html: null };
    expect(await service().readHtml('mail_1')).toEqual({ status: 'none' });

    fetchImpl.mockResolvedValueOnce(Response.json({}, { status: 404 }));
    expect(await service().readHtml('mail_1')).toEqual({ status: 'expired' });

    fetchImpl.mockResolvedValueOnce(Response.json({}, { status: 410 }));
    expect(await service().readHtml('mail_1')).toEqual({ status: 'expired' });
  });

  it('reports a provider outage as failed, so the reader can retry', async () => {
    fetchImpl.mockResolvedValueOnce(Response.json({}, { status: 503 }));

    expect(await service().readHtml('mail_1')).toEqual({ status: 'failed' });
  });

  it('refuses HTML too large to sanitize', async () => {
    message = { ...message, html: 'x'.repeat(3 * 1024 * 1024) };

    expect(await service().readHtml('mail_1')).toEqual({ status: 'failed' });
  });
});

describe('readAttachment', () => {
  it('returns the bytes under the name and type the mail declared', async () => {
    const file = await service().readAttachment('mail_1', 0);

    expect(file?.buffer.toString()).toBe('bytes');
    expect(file).toMatchObject({ contentType: 'text/html', filename: 'invoice.html' });
    expect(accounts.downloadProviderAttachment).toHaveBeenCalledWith('acc', 'prov_1', 0, {
      maxBytes: MAX_ATTACHMENT_DOWNLOAD_BYTES,
    });
  });

  it('downloads nothing for a mail outside the caller scope', async () => {
    model.findById.mockResolvedValue(undefined);

    expect(await service().readAttachment('mail_x', 0)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('downloads nothing for an index the mail does not list', async () => {
    expect(await service().readAttachment('mail_1', 7)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never downloads from a message that lives in another inbox', async () => {
    message = { ...message, inboxId: 'inbox_other' };

    expect(await service().readAttachment('mail_1', 0)).toBeNull();
    expect(paths).toEqual(['/v1/messages/prov_1']);
  });

  it('refuses an attachment declared over the cap before downloading it', async () => {
    const error = await service()
      .readAttachment('mail_1', 1)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentAccountError);
    expect((error as AgentAccountError).code).toBe('attachment_too_large');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses bytes over the cap even when the mail understated them', async () => {
    attachmentResponse = () =>
      new Response('x', {
        headers: { 'content-length': String(MAX_ATTACHMENT_DOWNLOAD_BYTES + 1) },
      });

    await expect(service().readAttachment('mail_1', 0)).rejects.toMatchObject({
      code: 'attachment_too_large',
    });
  });

  it('reads bytes the provider no longer holds as gone', async () => {
    attachmentResponse = () => new Response('', { status: 404 });

    expect(await service().readAttachment('mail_1', 0)).toBeNull();
  });

  it('throws on a provider outage, so the download stays retryable', async () => {
    attachmentResponse = () => new Response('', { status: 503 });

    await expect(service().readAttachment('mail_1', 0)).rejects.toMatchObject({ status: 503 });
  });
});
