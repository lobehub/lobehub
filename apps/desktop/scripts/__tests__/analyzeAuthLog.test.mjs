import { describe, expect, it } from 'vitest';

import { analyzeAuthLog, parseAuthEvents } from '../analyzeAuthLog.mjs';

const line = (ts, level, ns, msg) => `[${ts}] [${level}]  [${ns}] ${msg}`;
const codes = (text) => analyzeAuthLog(text).verdicts.map((v) => v.code);

describe('parseAuthEvents', () => {
  it('parses reason fields and ignores unrelated or continuation lines', () => {
    const text = [
      line('2026-09-06 19:01:00.000', 'info', 'core:App', '  OS: darwin (arm64)'),
      line(
        '2026-09-06 19:01:01.000',
        'info',
        'services:GatewayConnectionSrv',
        'Connection status: connected',
      ),
      '    at Yd.getAccessToken (main-app.js:54:20945)',
      line(
        '2026-09-06 19:01:02.000',
        'info',
        'core:BackendProxyProtocolManager',
        '[main] BackendProxy auth response proxy:main:status=401 POST /trpc/lambda/me hadToken=true authRequired=true token{sub=user_123 exp=2026-09-06T10:00:00.000Z expiredBy=3600s} authFailure=jwt_expired body={"error":{}}',
      ),
    ].join('\n');

    const events = parseAuthEvents(text);
    expect(events.map((e) => e.kind)).toEqual(['appStart', 'authResponse']);
    expect(events[1].fields).toMatchObject({
      authFailure: 'jwt_expired',
      authRequired: true,
      expiredBySeconds: 3600,
      hadToken: true,
      route: 'POST /trpc/lambda/me',
      status: 401,
    });
  });
});

describe('analyzeAuthLog verdicts', () => {
  it('flags safeStorage decrypt failure when a tokenless 401 follows it', () => {
    expect(
      codes(
        [
          line(
            '2026-09-06 19:01:25.167',
            'error',
            'controllers:RemoteServerConfigCtr',
            'Failed to decrypt access token: Error: Error while decrypting the ciphertext provided to safeStorage.decryptString.',
          ),
          line(
            '2026-09-06 19:01:26.000',
            'info',
            'core:BackendProxyProtocolManager',
            'Broadcasting authorizationRequired (reason=proxy:status=401 GET /trpc/lambda/me hadToken=false body=x)',
          ),
        ].join('\n'),
      ),
    ).toEqual(['SAFE_STORAGE_DECRYPT_FAILED']);
  });

  it('flags a revoked refresh token from the real 400 grant error', () => {
    expect(
      codes(
        [
          line(
            '2026-08-11 02:02:26.151',
            'info',
            'controllers:AuthCtr',
            'Token is expiring soon, triggering auto-refresh. Expires at: 2026-08-10T18:10:30.800Z',
          ),
          line(
            '2026-08-11 02:02:26.564',
            'error',
            'controllers:RemoteServerConfigCtr',
            'Token refresh failed: 400  grant request is invalid {',
          ),
          line(
            '2026-08-11 02:02:26.566',
            'error',
            'controllers:AuthCtr',
            'Auto-refresh failed after retries: Token refresh failed: 400  grant request is invalid',
          ),
          line(
            '2026-08-11 02:02:26.600',
            'info',
            'controllers:AuthCtr',
            'Broadcasting authorizationRequired event (reason=auto-refresh:non_retryable Token refresh failed: 400)',
          ),
        ].join('\n'),
      ),
    ).toEqual(['REFRESH_TOKEN_REVOKED']);
  });

  it('separates expired-not-refreshed, signature mismatch, header dropped and inactive user', () => {
    const at = (s, reason) =>
      line(
        `2026-09-07 10:00:0${s}.000`,
        'info',
        'core:BackendProxyProtocolManager',
        `[main] BackendProxy auth response ${reason}`,
      );
    expect(
      codes(
        [
          at(
            1,
            'proxy:status=401 POST /trpc/a hadToken=true authRequired=true token{expiredBy=5s} authFailure=jwt_expired',
          ),
          at(
            2,
            'proxy:status=401 POST /trpc/b hadToken=true authRequired=true token{expiresIn=500s} authFailure=jwt_signature',
          ),
          at(
            3,
            'proxy:status=401 POST /trpc/c hadToken=true authRequired=true token{expiresIn=500s} authFailure=no_token',
          ),
          at(
            4,
            'proxy:status=401 POST /trpc/d hadToken=true authRequired=true token{expiresIn=500s} authFailure=user_inactive',
          ),
        ].join('\n'),
      ),
    ).toEqual([
      'TOKEN_EXPIRED_NOT_REFRESHED',
      'SERVER_KEY_MISMATCH',
      'HEADER_DROPPED_IN_TRANSIT',
      'USER_INACTIVE',
    ]);
  });

  it('flags non-session 401s and old-build unknown rejections', () => {
    expect(
      codes(
        [
          line(
            '2026-09-07 10:00:01.000',
            'info',
            'core:BackendProxyProtocolManager',
            '[main] BackendProxy auth response proxy:status=401 POST /webapi/chat hadToken=true authRequired=false token=opaque body={"errorType":"InvalidProviderAPIKey"}',
          ),
          line(
            '2026-09-07 10:00:02.000',
            'info',
            'core:BackendProxyProtocolManager',
            'Broadcasting authorizationRequired (reason=proxy:status=401 POST /trpc/lambda/me hadToken=true body={"error":"UNAUTHORIZED"})',
          ),
        ].join('\n'),
      ),
    ).toEqual(['NON_SESSION_401', 'SERVER_REJECTED_UNKNOWN']);
  });

  it('reports NO_AUTH_EVENTS for a log with nothing relevant', () => {
    expect(
      codes(line('2026-09-07 10:00:01.000', 'info', 'core:App', 'PATH: /Applications')),
    ).toEqual(['NO_AUTH_EVENTS']);
  });
});
