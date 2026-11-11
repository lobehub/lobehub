import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_HANDOFF_LOCAL_RATE_LIMIT, AppHandoffError } from '../protocol';
import { AppHandoffService, type AppHandoffServiceDeps } from '../service';

const SERVER = 'https://app.example.com';
const ISSUER = `${SERVER}/oidc`;
const DESKTOP_TOKEN = 'desktop-access-token';
const EXE = '/opt/Native/native';

const validRequest = {
  client_id: 'native-app',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  issuer: ISSUER,
  redirect_uri: 'http://127.0.0.1:53682/callback',
  scope: 'openid profile email offline_access',
  state: 'state-1',
};

const targetsBody = {
  issuer: ISSUER,
  sub: 'user_a',
  targets: [
    {
      client_id: 'native-app',
      name: 'Native App',
      verification: { linux: { exeDirs: ['/opt/Native'] } },
    },
  ],
};

type Deps = { [K in keyof AppHandoffServiceDeps]-?: any };

const createDeps = (): Deps => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `${SERVER}/oidc/handoff/native` && init?.method === 'GET')
      return Response.json(targetsBody);
    if (url === `${SERVER}/oidc/handoff/native` && init?.method === 'POST') {
      return Response.json({ code: 'one-time-code', expires_in: 60, iss: ISSUER });
    }
    return new Response(null, { status: 200 });
  });
  return {
    confirm: vi.fn(async () => ({ allowed: true, remember: false })),
    fetch,
    findListener: vi.fn(async () => ({ pid: 4321, sameUser: true })),
    findPeer: vi.fn(async () => ({ exePath: EXE, pid: 4321, sameUser: true })),
    getSession: vi.fn(async () => ({ accessToken: DESKTOP_TOKEN, serverUrl: SERVER })),
    isTrusted: vi.fn(async () => false),
    log: { info: vi.fn(), warn: vi.fn() },
    now: vi.fn(() => Date.now()),
    trust: vi.fn(async () => {}),
    userAgent: 'LobeHub-Desktop/test',
    verifyExecutable: vi.fn(async () => true),
  };
};

let deps: Deps;
let service: AppHandoffService;

beforeEach(() => {
  deps = createDeps();
  service = new AppHandoffService(deps);
});

const code = (body: unknown = validRequest) => service.code(body, 5000, 61000);
const postCalls = () => deps.fetch.mock.calls.filter(([, init]: any) => init?.method === 'POST');

describe('POST /app-handoff/v1/code', () => {
  it('silently obtains a code for a verified caller and returns no desktop token', async () => {
    const result = await code();

    expect(result).toEqual({
      code: 'one-time-code',
      expires_in: 60,
      iss: ISSUER,
      state: 'state-1',
    });
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(DESKTOP_TOKEN);

    const [url, init] = postCalls()[0];
    expect(url).toBe(`${SERVER}/oidc/handoff/native`);
    expect(init.headers).toMatchObject({
      'Oidc-Auth': DESKTOP_TOKEN,
      'User-Agent': 'LobeHub-Desktop/test',
    });
    expect(JSON.parse(init.body)).toEqual({
      client_id: 'native-app',
      code_challenge: validRequest.code_challenge,
      code_challenge_method: 'S256',
      issuer: ISSUER,
      redirect_uri: validRequest.redirect_uri,
      scope: validRequest.scope,
    });
  });

  it('never touches the desktop refresh token: only the session provider is asked for a token', async () => {
    await code();

    expect(deps.getSession).toHaveBeenCalled();
    for (const [, init] of deps.fetch.mock.calls) {
      expect(String(init?.body ?? '')).not.toContain('refresh');
    }
  });

  it('refuses when the desktop app is not signed in', async () => {
    deps.getSession.mockResolvedValue(null);

    await expect(code()).rejects.toMatchObject({ code: 'not_signed_in', status: 401 });
    expect(postCalls()).toHaveLength(0);
  });

  it('refuses another issuer and says which one the desktop app uses', async () => {
    const error = await code({ ...validRequest, issuer: 'http://localhost:3010/oidc' }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(AppHandoffError);
    expect(error.status).toBe(409);
    expect(error.toJSON()).toMatchObject({ error: 'issuer_mismatch', issuer: ISSUER });
    expect(postCalls()).toHaveLength(0);
  });

  it('accepts the issuer with a trailing slash', async () => {
    await expect(code({ ...validRequest, issuer: `${ISSUER}/` })).resolves.toHaveProperty('code');
  });

  it('refuses when the caller is signed in as another user', async () => {
    await expect(code({ ...validRequest, sub: 'user_b' })).rejects.toMatchObject({
      code: 'user_mismatch',
      status: 409,
    });
    await expect(code({ ...validRequest, sub: 'user_a' })).resolves.toHaveProperty('code');
  });

  it('refuses a client the server does not list', async () => {
    await expect(code({ ...validRequest, client_id: 'lobehub-cli' })).rejects.toMatchObject({
      code: 'unauthorized_client',
    });
  });

  it('refuses a caller running as another OS user, without asking', async () => {
    deps.findPeer.mockResolvedValue({ exePath: EXE, pid: 4321, sameUser: false });

    await expect(code()).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it('refuses a redirect URI served by another process', async () => {
    deps.findListener.mockResolvedValue({ pid: 9999, sameUser: true });

    await expect(code()).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a redirect URI nobody, or another OS user, listens on', async () => {
    deps.findListener.mockResolvedValue(undefined);
    await expect(code()).rejects.toMatchObject({ code: 'forbidden' });

    deps.findListener.mockResolvedValue({ sameUser: false });
    await expect(code()).rejects.toMatchObject({ code: 'forbidden' });
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it('refuses a caller whose process cannot be identified, without asking', async () => {
    deps.findPeer.mockResolvedValue(undefined);

    await expect(code()).rejects.toMatchObject({ code: 'forbidden' });
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it('never refreshes the desktop token for a refused caller, and refreshes only after consent', async () => {
    deps.findPeer.mockResolvedValue({ sameUser: false });
    await expect(code()).rejects.toMatchObject({ code: 'forbidden' });
    expect(deps.getSession).not.toHaveBeenCalled();

    deps.findPeer.mockResolvedValue({ exePath: EXE, pid: 4321, sameUser: true });
    deps.verifyExecutable.mockResolvedValue(false);
    const order: string[] = [];
    deps.confirm.mockImplementation(async () => {
      order.push('confirm');
      return { allowed: true, remember: false };
    });
    deps.getSession.mockImplementation(async (options?: { refresh?: boolean }) => {
      order.push(options?.refresh ? 'refresh' : 'read');
      return { accessToken: DESKTOP_TOKEN, serverUrl: SERVER };
    });

    await code();
    expect(order.indexOf('refresh')).toBeGreaterThan(order.indexOf('confirm'));
    expect(order.filter((step) => step === 'refresh')).toHaveLength(1);
  });

  it('never refreshes for a status request', async () => {
    await service.status(5000, 61000);

    for (const [options] of deps.getSession.mock.calls) expect(options).toEqual({ refresh: false });
  });

  it.each([
    ['a non-loopback redirect', { redirect_uri: 'https://evil.example/callback' }],
    ['a loopback redirect without port', { redirect_uri: 'http://127.0.0.1/callback' }],
    ['a missing challenge', { code_challenge: undefined }],
    ['a plain challenge', { code_challenge_method: 'plain' }],
    ['a missing state', { state: undefined }],
  ])('rejects %s', async (_label, patch) => {
    await expect(code({ ...validRequest, ...patch })).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  describe('an unverified caller', () => {
    beforeEach(() => {
      deps.verifyExecutable.mockResolvedValue(false);
    });

    it('is asked about, and refused when the user says no', async () => {
      deps.confirm.mockResolvedValue({ allowed: false, remember: false });

      await expect(code()).rejects.toMatchObject({ code: 'denied', status: 403 });
      expect(deps.confirm).toHaveBeenCalledWith({
        appName: 'Native App',
        exePath: EXE,
        rememberable: true,
      });
      expect(postCalls()).toHaveLength(0);
    });

    it('is remembered when the user ticks "always allow"', async () => {
      deps.confirm.mockResolvedValue({ allowed: true, remember: true });

      await expect(code()).resolves.toHaveProperty('code');
      expect(deps.trust).toHaveBeenCalledWith('native-app', EXE);
    });

    it('is not asked again once trusted', async () => {
      deps.isTrusted.mockResolvedValue(true);

      await expect(code()).resolves.toHaveProperty('code');
      expect(deps.confirm).not.toHaveBeenCalled();
    });

    it('is asked about without "always allow" when its executable path is unknown', async () => {
      deps.findPeer.mockResolvedValue({ pid: 4321, sameUser: true });

      await code();
      expect(deps.confirm).toHaveBeenCalledWith({
        appName: 'Native App',
        exePath: undefined,
        rememberable: false,
      });
    });
  });

  it.each([
    [{ error: 'issuer_mismatch' }, 409, 'issuer_mismatch'],
    [{ error: 'user_mismatch' }, 409, 'user_mismatch'],
    [{ error: 'rate_limited' }, 429, 'rate_limited'],
    [{ error: 'invalid_token' }, 401, 'not_signed_in'],
    [{ error: 'not_available' }, 404, 'not_available'],
    [{ error: 'boom' }, 500, 'server_error'],
  ])('maps server error %j to %s', async (body, status, expected) => {
    deps.fetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'GET' ? Response.json(targetsBody) : Response.json(body, { status }),
    );

    await expect(code()).rejects.toMatchObject({ code: expected });
  });

  it('rejects a response for another issuer', async () => {
    deps.fetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'GET'
        ? Response.json(targetsBody)
        : Response.json({ code: 'c', expires_in: 60, iss: 'https://other/oidc' }),
    );

    await expect(code()).rejects.toMatchObject({ code: 'server_error' });
  });
});

describe('handle()', () => {
  it(`allows ${APP_HANDOFF_LOCAL_RATE_LIMIT} requests a minute`, async () => {
    for (let index = 0; index < APP_HANDOFF_LOCAL_RATE_LIMIT; index += 1) {
      await service.handle({ remotePort: 1, route: 'status' }, 5000);
    }
    await expect(service.handle({ remotePort: 1, route: 'status' }, 5000)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
    expect(deps.log.warn).toHaveBeenCalledWith(
      '[AppHandoff] refused',
      expect.objectContaining({ error: 'rate_limited', route: 'status' }),
    );
  });

  it('logs a refused code request with the reason, never a token', async () => {
    await expect(
      service.handle(
        { body: { ...validRequest, issuer: 'http://other/oidc' }, remotePort: 1, route: 'code' },
        5000,
      ),
    ).rejects.toMatchObject({ code: 'issuer_mismatch' });

    const [line, fields] = deps.log.warn.mock.calls.at(-1);
    expect(line).toBe('[AppHandoff] refused');
    expect(fields).toMatchObject({
      clientId: 'native-app',
      error: 'issuer_mismatch',
      route: 'code',
    });
    expect(JSON.stringify(fields)).not.toContain(DESKTOP_TOKEN);
  });
});

describe('GET /app-handoff/v1/status', () => {
  it('names the user to a verified caller', async () => {
    await expect(service.status(5000, 61000)).resolves.toEqual({
      issuer: ISSUER,
      signedIn: true,
      sub: 'user_a',
    });
  });

  it('keeps the user id from an unrecognised caller and never asks', async () => {
    deps.verifyExecutable.mockResolvedValue(false);

    await expect(service.status(5000, 61000)).resolves.toEqual({ issuer: ISSUER, signedIn: true });
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it('reports a signed-out desktop app', async () => {
    deps.getSession.mockResolvedValue(null);

    await expect(service.status(5000, 61000)).resolves.toEqual({ issuer: '', signedIn: false });
  });
});

describe('deep link', () => {
  const params = { ...validRequest } as Record<string, string>;
  const delivered = () =>
    deps.fetch.mock.calls.find(([url]: any) => url === validRequest.redirect_uri);

  it('always asks, then posts the code to the loopback redirect', async () => {
    await expect(service.deepLink(params)).resolves.toBe(true);

    expect(deps.confirm).toHaveBeenCalledWith({ appName: 'Native App', rememberable: false });
    expect(deps.verifyExecutable).not.toHaveBeenCalled();
    const [, init] = delivered();
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      code: 'one-time-code',
      iss: ISSUER,
      state: 'state-1',
    });
  });

  it('posts the refusal instead of a code', async () => {
    deps.confirm.mockResolvedValue({ allowed: false, remember: false });

    await expect(service.deepLink(params)).resolves.toBe(false);
    const [, init] = delivered();
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      error: 'denied',
      state: 'state-1',
    });
  });

  it('sends nothing, not even an error, to a redirect another OS user listens on', async () => {
    deps.findListener.mockResolvedValue({ sameUser: false });

    await expect(service.deepLink(params)).resolves.toBe(false);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('ignores a link whose redirect is not a loopback URI', async () => {
    await expect(
      service.deepLink({ ...params, redirect_uri: 'https://evil.example/cb' }),
    ).resolves.toBe(false);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
