import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinqApiClient } from './api';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

describe('LinqApiClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createClient = (overrides: Partial<ConstructorParameters<typeof LinqApiClient>[0]> = {}) =>
    new LinqApiClient({
      apiKey: 'test-key',
      baseUrl: 'https://linq.test/v3',
      fromNumber: '+15550000001',
      ...overrides,
    });

  it('defaults to the Linq production base URL and rejects a missing key', () => {
    expect(new LinqApiClient({ apiKey: 'k' }).baseUrl).toBe('https://api.linqapp.com/v3');
    expect(() => new LinqApiClient({ apiKey: '  ' })).toThrow('Linq apiKey is required');
  });

  it('sends a bearer-authenticated text message to POST /chats/{chatId}/messages', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ chat_id: 'c1', message: { id: 'm1' } }));

    const client = createClient();
    const result = await client.sendText('chat 1', 'hello **world**');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://linq.test/v3/chats/chat%201/messages');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body)).toEqual({
      message: { parts: [{ type: 'text', value: 'hello **world**' }] },
    });
    expect(result.message.id).toBe('m1');
  });

  it('passes an idempotency key through to the message body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ chat_id: 'c1', message: { id: 'm1' } }));

    await createClient().sendText('c1', 'hi', { idempotencyKey: 'push-1' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      message: { idempotency_key: 'push-1', parts: [{ type: 'text', value: 'hi' }] },
    });
  });

  it('opens a chat with POST /chats when the handle has no chat yet', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ chats: [] }))
      .mockResolvedValueOnce(jsonResponse({ chat: { id: 'new-chat' } }));

    const result = await createClient().sendToHandle({ handle: '+15550000002', text: 'first' });

    const [listUrl] = fetchMock.mock.calls[0];
    expect(listUrl).toBe('https://linq.test/v3/chats?limit=1&to=%2B15550000002');

    const [createUrl, createInit] = fetchMock.mock.calls[1];
    expect(createUrl).toBe('https://linq.test/v3/chats');
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(createInit.body)).toEqual({
      from: '+15550000001',
      message: { parts: [{ type: 'text', value: 'first' }] },
      to: ['+15550000002'],
    });
    expect(result.chatId).toBe('new-chat');
  });

  it('reuses an existing chat instead of opening a second one', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ chats: [{ id: 'existing' }] }))
      .mockResolvedValueOnce(jsonResponse({ chat_id: 'existing', message: { id: 'm9' } }));

    const result = await createClient().sendToHandle({ handle: '+15550000002', text: 'again' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://linq.test/v3/chats/existing/messages');
    expect(result).toEqual({ chatId: 'existing', message: { id: 'm9' } });
  });

  it('refuses to open a chat without a from number', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ chats: [] }));
    const client = createClient({ fromNumber: undefined });

    await expect(client.sendToHandle({ handle: '+1', text: 'x' })).rejects.toThrow(
      'Linq createChat requires a from number (LINQ_FROM_NUMBER)',
    );
  });

  it('drives typing with POST and DELETE on /chats/{chatId}/typing', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const client = createClient();

    await client.startTyping('c1');
    await client.stopTyping('c1');

    expect(fetchMock.mock.calls[0][0]).toBe('https://linq.test/v3/chats/c1/typing');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(fetchMock.mock.calls[1][0]).toBe('https://linq.test/v3/chats/c1/typing');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('marks a chat read with POST /chats/{chatId}/read', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await createClient().markRead('c1');

    expect(fetchMock.mock.calls[0][0]).toBe('https://linq.test/v3/chats/c1/read');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('pre-uploads an attachment via POST /attachments then a presigned PUT', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          attachment_id: 'att-1',
          http_method: 'PUT',
          required_headers: { 'content-type': 'image/png' },
          upload_url: 'https://upload.test/put/att-1',
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const attachmentId = await createClient().uploadAttachment({
      data: Buffer.from('png-bytes').toString('base64'),
      mimeType: 'image/png',
      name: 'chart.png',
    });

    expect(attachmentId).toBe('att-1');

    const [createUrl, createInit] = fetchMock.mock.calls[0];
    expect(createUrl).toBe('https://linq.test/v3/attachments');
    expect(createInit.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(createInit.body)).toEqual({
      content_type: 'image/png',
      filename: 'chart.png',
      size_bytes: 9,
    });

    const [putUrl, putInit] = fetchMock.mock.calls[1];
    expect(putUrl).toBe('https://upload.test/put/att-1');
    expect(putInit.method).toBe('PUT');
    // The presigned URL carries its own credentials — never leak the API key.
    expect(putInit.headers.Authorization).toBeUndefined();
    expect(putInit.headers['content-type']).toBe('image/png');
    expect(Buffer.from(putInit.body).toString()).toBe('png-bytes');
  });

  it('sends a pre-uploaded attachment as a media part after the text leg', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          attachment_id: 'att-2',
          required_headers: {},
          upload_url: 'https://u.test',
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ chats: [{ id: 'c1' }] }))
      .mockResolvedValueOnce(jsonResponse({ chat_id: 'c1', message: { id: 'm2' } }));

    await createClient().sendToHandle({
      attachment: { data: Buffer.from('x').toString('base64'), mimeType: 'application/pdf' },
      handle: '+15550000002',
      text: 'report',
    });

    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
      message: {
        parts: [
          { type: 'text', value: 'report' },
          { type: 'media', attachment_id: 'att-2' },
        ],
      },
    });
  });

  it('surfaces the upstream error code and message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 2024, message: 'Recipient opted out' } }, 403),
    );

    await expect(createClient().sendText('c1', 'hi')).rejects.toThrow('Recipient opted out (2024)');
  });

  it('rejects consecutive text parts before hitting the API', async () => {
    await expect(
      createClient().sendMessage('c1', [
        { type: 'text', value: 'a' },
        { type: 'text', value: 'b' },
      ]),
    ).rejects.toThrow('Linq rejects consecutive text parts');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pings through GET /phone_numbers for credential validation', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ phone_numbers: [] }));

    await createClient().ping();

    expect(fetchMock.mock.calls[0][0]).toBe('https://linq.test/v3/phone_numbers?limit=1');
  });
});
