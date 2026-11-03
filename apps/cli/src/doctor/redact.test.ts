import { describe, expect, it } from 'vitest';

import {
  maskEmail,
  redactUrlCredentials,
  redactUrlsInMessage,
  scrubDeep,
  scrubText,
} from './redact';

describe('redactUrlCredentials', () => {
  it('keeps the host and drops the credential', () => {
    expect(redactUrlCredentials('https://alice:hunter2@lobe.internal:8443/x')).toBe(
      'https://***:***@lobe.internal:8443/x',
    );
  });

  it('leaves a credential-free URL untouched', () => {
    expect(redactUrlCredentials('https://app.lobehub.com')).toBe('https://app.lobehub.com');
  });

  it('passes through a value that is not a URL', () => {
    // NO_PROXY is a host list, not a URL.
    expect(redactUrlCredentials('localhost,127.0.0.1,.internal')).toBe(
      'localhost,127.0.0.1,.internal',
    );
  });
});

describe('maskEmail', () => {
  it('leaves enough to recognise the account and no more', () => {
    expect(maskEmail('arvin.xu@example.com')).toBe('a***@e***.com');
  });

  it('does not pass through something that is not an address', () => {
    expect(maskEmail('not-an-email')).toBe('***');
  });
});

describe('redactUrlsInMessage', () => {
  it('drops the query string a gateway error quotes', () => {
    const message =
      "WebSocket connection to 'ws://127.0.0.1:9/ws?deviceId=d1&hostname=mac&userId=user_1' failed";

    const redacted = redactUrlsInMessage(message);

    expect(redacted).toBe("WebSocket connection to 'ws://127.0.0.1:9/ws' failed");
    expect(redacted).not.toContain('user_1');
  });

  it('stays linear on input built to make it backtrack', () => {
    const hostile = `${'ws://'.repeat(20_000)}x`;

    const startedAt = Date.now();
    redactUrlsInMessage(hostile);

    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});

describe('scrubText', () => {
  it('scrubs a credential-bearing URL quoted inside an error message', () => {
    // Node's fetch error names the full request URL.
    expect(
      scrubText('fetch failed for https://alice:hunter2@lobe.internal/api/version (ECONNREFUSED)'),
    ).toBe('fetch failed for https://***@lobe.internal/api/version (ECONNREFUSED)');
  });

  it('masks a bare email and strips a WebSocket query', () => {
    expect(scrubText("user arvin@example.com via 'wss://gw.example.com/ws?userId=u1'")).toBe(
      "user a***@e***.com via 'wss://gw.example.com/ws'",
    );
  });

  it('leaves ordinary text alone', () => {
    const text = 'node v24.3.0 on darwin/arm64, 2 installs at /opt/homebrew/bin/lh';
    expect(scrubText(text)).toBe(text);
  });

  it('stays linear on hostile input', () => {
    const startedAt = Date.now();
    scrubText(`${'https://a@'.repeat(20_000)}x ${'@'.repeat(50_000)}`);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});

describe('scrubDeep', () => {
  it('reaches strings nested anywhere in evidence', () => {
    const scrubbed = scrubDeep({
      evidence: {
        gateways: ['wss://bob:pw@gw.internal/ws'],
        nested: { server: 'https://a:b@s.internal' },
      },
      status: 'ok',
    });

    expect(JSON.stringify(scrubbed)).not.toMatch(/pw@|a:b@/);
    expect(scrubbed.status).toBe('ok');
  });
});
