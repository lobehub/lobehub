// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentAccountError } from '@/server/services/agentIdentity/errors';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  readAttachment: vi.fn(),
  resolveWorkspace: vi.fn(),
  scopes: [] as (string | undefined)[],
}));

vi.mock('@/app/(backend)/middleware/auth', () => ({
  checkAuth:
    (handler: (req: Request, context: { serverDB: object; userId: string }) => Promise<Response>) =>
    (req: Request) =>
      handler(req, { serverDB: {}, userId: 'user-1' }),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn(async () => ({})) },
}));

vi.mock('@/server/services/agentIdentity/providers', () => ({
  createDefaultAgentAccountRegistry: vi.fn(() => ({})),
}));

vi.mock('@/server/services/agentIdentity', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  AgentAccountService: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/server/services/agentIdentity/mailbox', () => ({
  AgentMailboxService: vi.fn(function (_db: unknown, _user: string, options: any) {
    mocks.scopes.push(options.workspaceId);
    return { readAttachment: mocks.readAttachment };
  }),
}));

vi.mock('../../_utils/workspace', () => ({
  WORKSPACE_ID_HEADER: 'X-Workspace-Id',
  resolveValidWorkspaceIdFromRequest: mocks.resolveWorkspace,
}));

const MAIL_ID = '0b9d6f4e-8c1a-4f53-9a57-3b8f4c2d1e6a';

const get = (query: string, headers: Record<string, string> = {}) =>
  GET(new Request(`https://example.com/webapi/agent-mail/attachment?${query}`, { headers }), {
    params: Promise.resolve({}),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scopes = [];
  mocks.resolveWorkspace.mockResolvedValue(undefined);
  mocks.readAttachment.mockResolvedValue({
    buffer: Buffer.from('<script>alert(1)</script>'),
    contentType: 'text/html',
    filename: 'invoice.html',
  });
});

describe('GET /webapi/agent-mail/attachment', () => {
  it('serves the bytes as an inert download, whatever type the mail claimed', async () => {
    const response = await get(`id=${MAIL_ID}&index=0`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<script>alert(1)</script>');
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'cache-control': 'private, no-store',
      'content-disposition': `attachment; filename="invoice.html"; filename*=UTF-8''invoice.html`,
      'content-length': '25',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-type': 'application/octet-stream',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
    });
    expect(mocks.readAttachment).toHaveBeenCalledWith(MAIL_ID, 0);
  });

  it('keeps a hostile filename inside its header', async () => {
    mocks.readAttachment.mockResolvedValue({
      buffer: Buffer.from('x'),
      filename: `a"\r\nSet-Cookie: x=1;\\../报告'(1).pdf`,
    });

    const disposition = (await get(`id=${MAIL_ID}&index=0`)).headers.get('content-disposition')!;

    expect(disposition).toBe(
      `attachment; filename="a___Set-Cookie: x=1;_..___'(1).pdf"; ` +
        `filename*=UTF-8''a%22%0D%0ASet-Cookie%3A%20x%3D1%3B%5C..%2F%E6%8A%A5%E5%91%8A%27%281%29.pdf`,
    );
  });

  it('names an unnamed attachment by its index', async () => {
    mocks.readAttachment.mockResolvedValue({ buffer: Buffer.from('x') });

    const response = await get(`id=${MAIL_ID}&index=3`);

    expect(response.headers.get('content-disposition')).toContain('filename="attachment-3"');
  });

  it.each([
    ['no id', 'index=0'],
    ['a non-uuid id', 'id=mail_1&index=0'],
    ['no index', `id=${MAIL_ID}`],
    ['an empty index', `id=${MAIL_ID}&index=`],
    ['a negative index', `id=${MAIL_ID}&index=-1`],
    ['a fractional index', `id=${MAIL_ID}&index=1.5`],
    ['an exponent index', `id=${MAIL_ID}&index=1e3`],
  ])('rejects %s before reading anything', async (_, query) => {
    const response = await get(query);

    expect(response.status).toBe(400);
    expect(mocks.readAttachment).not.toHaveBeenCalled();
  });

  it('reads inside the workspace the caller is a member of', async () => {
    mocks.resolveWorkspace.mockResolvedValue('ws-1');

    await get(`id=${MAIL_ID}&index=0`, { 'X-Workspace-Id': 'ws-1' });

    expect(mocks.scopes).toEqual(['ws-1']);
  });

  it('refuses a workspace the caller is not a member of instead of reading personal mail', async () => {
    const response = await get(`id=${MAIL_ID}&index=0`, { 'X-Workspace-Id': 'ws-foreign' });

    expect(response.status).toBe(403);
    expect(mocks.readAttachment).not.toHaveBeenCalled();
  });

  it('reads as expired when the mail or its bytes are gone', async () => {
    mocks.readAttachment.mockResolvedValue(null);

    const response = await get(`id=${MAIL_ID}&index=0`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'expired' });
  });

  it('refuses an attachment over the cap', async () => {
    mocks.readAttachment.mockRejectedValue(new AgentAccountError('attachment_too_large', 'big'));

    const response = await get(`id=${MAIL_ID}&index=0`);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'too_large' });
  });

  it('reports a provider outage as retryable, without its details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.readAttachment.mockRejectedValue(new Error('upstream secret detail'));

    const response = await get(`id=${MAIL_ID}&index=0`);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'unavailable' });
  });
});
