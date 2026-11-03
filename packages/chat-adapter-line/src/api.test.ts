import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeSignature, LineApiClient, verifySignature } from './api';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

afterEach(() => {
  fetchSpy.mockReset();
});

describe('computeSignature / verifySignature', () => {
  it('round-trips on matching body + secret using base64', () => {
    const body = '{"hello":"world"}';
    const secret = 'shh';
    const sig = computeSignature(body, secret);
    // LINE uses base64 (not hex / not "sha256=" prefix).
    expect(sig).toMatch(/^[A-Z0-9+/=]+$/i);
    expect(verifySignature(body, sig, secret)).toBe(true);
  });

  it('rejects tampered body, wrong secret, missing header', () => {
    const body = '{"hello":"world"}';
    const sig = computeSignature(body, 'shh');
    expect(verifySignature('tampered', sig, 'shh')).toBe(false);
    expect(verifySignature(body, sig, 'other')).toBe(false);
    expect(verifySignature(body, null, 'shh')).toBe(false);
    expect(verifySignature(body, sig, '')).toBe(false);
  });
});

describe('LineApiClient', () => {
  beforeEach(() => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
  });

  it('pushText posts to /v2/bot/message/push with bearer header + text envelope', async () => {
    const api = new LineApiClient({ accessToken: 't' });
    await api.pushText('U-target', 'hello');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      messages: [{ text: 'hello', type: 'text' }],
      to: 'U-target',
    });
  });

  it('startLoading defaults to 20 seconds', async () => {
    const api = new LineApiClient({ accessToken: 't' });
    await api.startLoading('U-target');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.line.me/v2/bot/chat/loading/start');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ chatId: 'U-target', loadingSeconds: 20 });
  });

  it('downloadContent hits the data subdomain with bearer header', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const api = new LineApiClient({ accessToken: 't' });
    const buf = await api.downloadContent('msg-1');

    expect(buf).toEqual(Buffer.from([1, 2, 3]));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api-data.line.me/v2/bot/message/msg-1/content');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('getBotInfo throws with the LINE error envelope message on failure', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Authentication failed.' }), { status: 401 }),
    );
    const api = new LineApiClient({ accessToken: 'bad' });
    await expect(api.getBotInfo()).rejects.toThrow('Authentication failed.');
  });

  it('pushText surfaces details[0].message when the API returns a 4xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          details: [{ message: 'Invalid recipient', property: 'to' }],
          message: 'Bad request',
        }),
        { status: 400 },
      ),
    );
    const api = new LineApiClient({ accessToken: 't' });
    await expect(api.pushText('U-target', 'hi')).rejects.toThrow(/Invalid recipient/);
  });
});
