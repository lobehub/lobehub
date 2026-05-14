import { afterEach, describe, expect, it, vi } from 'vitest';

import { WhatsAppClientFactory } from './client';

const fetchSpy = vi.spyOn(globalThis, 'fetch');
const PHONE_NUMBER_ID = '123456789012345';

const createClient = () =>
  new WhatsAppClientFactory().createClient(
    {
      applicationId: PHONE_NUMBER_ID,
      credentials: {
        accessToken: 'token-test',
        appSecret: 'secret-test',
        verifyToken: 'verify-test',
      },
      platform: 'whatsapp',
      settings: {},
    },
    {},
  );

afterEach(() => {
  fetchSpy.mockReset();
});

describe('WhatsAppWebhookClient', () => {
  it('createAdapter wires credentials into the SDK adapter', () => {
    const client = createClient();
    const adapter = client.createAdapter();
    expect(adapter.whatsapp).toBeDefined();
    expect((adapter.whatsapp as any).botUserId).toBe(PHONE_NUMBER_ID);
  });

  it('messenger.createMessage POSTs to the Cloud API messages endpoint', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.out' }] }), { status: 200 }),
    );

    const client = createClient();
    const messenger = client.getMessenger('whatsapp:user:15551234567');
    await messenger.createMessage('hi back');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '15551234567',
      type: 'text',
    });
    expect(body.text.body).toBe('hi back');
  });

  it('extractFiles downloads WhatsApp media from metadata-only attachments', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            file_size: 11,
            id: 'media-1',
            mime_type: 'image/jpeg',
            url: 'https://lookaside.facebook.com/media-1',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(Buffer.from('image-bytes'), { status: 200 }));

    const client = createClient();
    const sources = await client.extractFiles!({
      attachments: [
        {
          raw: {
            from: '15551234567',
            id: 'wamid.in',
            image: { id: 'media-1', mime_type: 'image/jpeg' },
            type: 'image',
          },
        },
      ],
      id: 'merged',
      raw: { id: 'text', text: { body: 'follow up' }, type: 'text' },
    } as any);

    expect(sources).toEqual([
      {
        buffer: Buffer.from('image-bytes'),
        mimeType: 'image/jpeg',
        name: 'image.jpg',
        size: 11,
      },
    ]);
  });
});

describe('WhatsAppClientFactory.validateCredentials', () => {
  it('reports missing fields without hitting the network', async () => {
    const factory = new WhatsAppClientFactory();
    const result = await factory.validateCredentials({});

    expect(result.valid).toBe(false);
    expect((result.errors ?? []).map((e) => e.field).sort()).toEqual([
      'accessToken',
      'appSecret',
      'applicationId',
      'verifyToken',
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns valid=true when the access token can read the configured phone number', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: PHONE_NUMBER_ID, display_phone_number: '+15550001111' }), {
        status: 200,
      }),
    );

    const factory = new WhatsAppClientFactory();
    const result = await factory.validateCredentials(
      { accessToken: 'good', appSecret: 'secret', verifyToken: 'verify' },
      undefined,
      PHONE_NUMBER_ID,
    );

    expect(result.valid).toBe(true);
  });

  it('surfaces Cloud API errors on credential validation failure', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token.' } }), {
        status: 401,
      }),
    );

    const factory = new WhatsAppClientFactory();
    const result = await factory.validateCredentials(
      { accessToken: 'bad', appSecret: 'secret', verifyToken: 'verify' },
      undefined,
      PHONE_NUMBER_ID,
    );

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toEqual({
      field: 'accessToken',
      message: 'Invalid OAuth access token.',
    });
  });
});
