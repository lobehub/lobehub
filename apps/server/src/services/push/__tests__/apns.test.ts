import { generateKeyPairSync, verify } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http2 from 'node:http2';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApnsClient,
  type ApnsRequest,
  type ApnsResponse,
  createHttp2Transport,
  getApnsConfigFromEnv,
} from '../apns';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const config = { bundleId: 'com.lobehub.lobot', key: pem, keyId: 'KEY123', teamId: 'TEAM456' };
const deviceToken = 'ab'.repeat(32);

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

const transportReturning = (...responses: ApnsResponse[]) => {
  const calls: ApnsRequest[] = [];
  const transport = vi.fn(async (request: ApnsRequest) => {
    calls.push(request);
    return responses.shift() ?? { body: '', status: 200 };
  });
  return { calls, transport };
};

describe('getApnsConfigFromEnv', () => {
  it('is undefined unless key id, team id and key are all set', () => {
    expect(getApnsConfigFromEnv({})).toBeUndefined();
    expect(getApnsConfigFromEnv({ APNS_KEY: pem, APNS_KEY_ID: 'k' })).toBeUndefined();
  });

  it('accepts a PEM with escaped newlines or a base64 encoded .p8 file', () => {
    const escaped = getApnsConfigFromEnv({
      APNS_BUNDLE_ID: 'com.lobehub.lobot',
      APNS_KEY: pem.replaceAll('\n', '\\n'),
      APNS_KEY_ID: 'k',
      APNS_TEAM_ID: 't',
    });
    expect(escaped).toEqual({
      bundleId: 'com.lobehub.lobot',
      key: pem.trim(),
      keyId: 'k',
      teamId: 't',
    });

    const encoded = getApnsConfigFromEnv({
      APNS_KEY: Buffer.from(pem).toString('base64'),
      APNS_KEY_ID: 'k',
      APNS_TEAM_ID: 't',
    });
    expect(encoded?.key).toBe(pem.trim());
    expect(encoded?.bundleId).toBeUndefined();
  });
});

describe('ApnsClient', () => {
  it('signs an ES256 provider token APNs can verify, and reuses it for 50 minutes', () => {
    let now = 1_700_000_000_000;
    const client = new ApnsClient(config, { now: () => now, transport: vi.fn() });

    const jwt = client.providerToken();
    const [header, claims, signature] = jwt.split('.');
    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(decode(claims)).toEqual({ iat: 1_700_000_000, iss: 'TEAM456' });
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${claims}`),
        { dsaEncoding: 'ieee-p1363', key: publicKey },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);

    now += 49 * 60 * 1000;
    expect(client.providerToken()).toBe(jwt);
    now += 2 * 60 * 1000;
    expect(client.providerToken()).not.toBe(jwt);
  });

  it('posts an alert push to the gateway of the token environment', async () => {
    const { calls, transport } = transportReturning({ body: '', status: 200 });
    const client = new ApnsClient(config, { transport });

    const result = await client.send({
      environment: 'sandbox',
      payload: { aps: { alert: { body: 'b', title: 't' } } },
      token: deviceToken,
    });

    expect(result).toEqual({ status: 'ok' });
    expect(calls[0]).toMatchObject({
      body: JSON.stringify({ aps: { alert: { body: 'b', title: 't' } } }),
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
        'apns-topic': 'com.lobehub.lobot',
        'content-type': 'application/json',
      },
      origin: 'https://api.sandbox.push.apple.com',
      path: `/3/device/${deviceToken}`,
    });
    expect(calls[0].headers.authorization).toBe(`bearer ${client.providerToken()}`);
  });

  it('uses the registration bundle id over the configured one', async () => {
    const { calls, transport } = transportReturning();
    await new ApnsClient(config, { transport }).send({
      environment: 'production',
      payload: {},
      token: deviceToken,
      topic: 'com.example.other',
    });
    expect(calls[0].headers['apns-topic']).toBe('com.example.other');
    expect(calls[0].origin).toBe('https://api.push.apple.com');
  });

  it('reports the APNs rejection reason', async () => {
    const { transport } = transportReturning({ body: '{"reason":"Unregistered"}', status: 410 });
    await expect(
      new ApnsClient(config, { transport }).send({
        environment: 'production',
        payload: {},
        token: deviceToken,
      }),
    ).resolves.toEqual({ reason: 'Unregistered', status: 'error', statusCode: 410 });
  });

  it('re-signs the provider token once when APNs says it expired', async () => {
    let now = 1_700_000_000_000;
    const { calls, transport } = transportReturning(
      { body: '{"reason":"ExpiredProviderToken"}', status: 403 },
      { body: '', status: 200 },
    );
    const client = new ApnsClient(config, { now: () => now, transport });
    client.providerToken();
    now += 1000;

    await expect(
      client.send({ environment: 'production', payload: {}, token: deviceToken }),
    ).resolves.toEqual({ status: 'ok' });
    expect(calls).toHaveLength(2);
    expect(calls[1].headers.authorization).not.toBe(calls[0].headers.authorization);
  });

  it('fails without a request when no topic is known', async () => {
    const { transport } = transportReturning();
    const client = new ApnsClient({ ...config, bundleId: undefined }, { transport });
    await expect(
      client.send({ environment: 'production', payload: {}, token: deviceToken }),
    ).resolves.toEqual({ reason: 'MissingTopic', status: 'error', statusCode: 0 });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('createHttp2Transport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fakeSession = (status: number, body: string) => {
    const session = Object.assign(new EventEmitter(), {
      closed: false,
      destroyed: false,
      request: vi.fn((headers: Record<string, string>) => {
        const stream = Object.assign(new EventEmitter(), {
          close: vi.fn(),
          end: vi.fn((payload: string) => {
            stream.sent = { headers, payload };
            queueMicrotask(() => {
              stream.emit('response', { ':status': status });
              stream.emit('data', body);
              stream.emit('end');
            });
          }),
          sent: undefined as unknown,
          setEncoding: vi.fn(),
          setTimeout: vi.fn(),
        });
        return stream;
      }),
      unref: vi.fn(),
    });
    return session;
  };

  it('sends over one HTTP/2 session per origin and returns status and body', async () => {
    const session = fakeSession(400, '{"reason":"BadDeviceToken"}');
    const connect = vi.spyOn(http2, 'connect').mockReturnValue(session as any);
    const transport = createHttp2Transport();
    const request = {
      body: '{}',
      headers: { 'apns-topic': 'com.lobehub.lobot' },
      origin: 'https://api.push.apple.com',
      path: `/3/device/${deviceToken}`,
    };

    await expect(transport(request)).resolves.toEqual({
      body: '{"reason":"BadDeviceToken"}',
      status: 400,
    });
    await transport(request);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith('https://api.push.apple.com');
    expect(session.request).toHaveBeenCalledWith({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'apns-topic': 'com.lobehub.lobot',
    });

    // A closed session is replaced on the next request.
    session.emit('close');
    await transport(request);
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
