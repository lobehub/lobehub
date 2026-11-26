import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAgentCredential } from './check';
import { installAgentCredential } from './store';

const TOKEN = 'sk-ant-oat01-secret-token-value';
const ACCESS = 'codex-access-token-value';
const NOW = Date.parse('2026-06-01T00:00:00.000Z');

let rootDir: string;

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

const installClaude = (expiresAt = '2026-07-01T00:00:00.000Z') =>
  installAgentCredential(
    { provider: 'claude-code', secret: { expiresAt, token: TOKEN, type: 'claude-oauth-token' } },
    { rootDir },
  );

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'lh-agent-cred-check-'));
});

afterEach(async () => {
  await rm(rootDir, { force: true, recursive: true });
});

describe('checkAgentCredential', () => {
  it('reports a missing credential without calling the provider', async () => {
    const fetch = vi.fn();
    const result = await checkAgentCredential(
      { provider: 'claude-code' },
      { fetch, now: () => NOW, rootDir },
    );

    expect(result).toMatchObject({
      checkedAt: '2026-06-01T00:00:00.000Z',
      installed: false,
      ok: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('confirms a Claude Code token with a token-count call that runs no model', async () => {
    await installClaude();
    const fetch = vi.fn(async () => jsonResponse(200, { input_tokens: 9 }));

    const result = await checkAgentCredential(
      { provider: 'claude-code' },
      { fetch, now: () => NOW, rootDir },
    );

    expect(result).toEqual({
      checkedAt: '2026-06-01T00:00:00.000Z',
      expiresAt: '2026-07-01T00:00:00.000Z',
      installed: true,
      ok: true,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
    expect(init.headers).toMatchObject({
      'Authorization': `Bearer ${TOKEN}`,
      'anthropic-beta': 'oauth-2025-04-20',
    });
  });

  it('returns the reason on 401 and never the token', async () => {
    await installClaude();
    const fetch = vi.fn(async () =>
      jsonResponse(401, {
        error: { message: `Invalid bearer token ${TOKEN}`, type: 'authentication_error' },
      }),
    );

    const result = await checkAgentCredential(
      { provider: 'claude-code' },
      { fetch, now: () => NOW, rootDir },
    );

    expect(result.ok).toBe(false);
    expect(result.installed).toBe(true);
    expect(result.reason).toContain('HTTP 401');
    expect(result.reason).not.toContain(TOKEN);
  });

  it('treats another 4xx as authenticated but inconclusive, not a broken token', async () => {
    await installClaude();
    const fetch = vi.fn(async () =>
      jsonResponse(404, { error: { message: 'model not found', type: 'not_found_error' } }),
    );

    const result = await checkAgentCredential(
      { provider: 'claude-code' },
      { fetch, now: () => NOW, rootDir },
    );

    expect(result.ok).toBe(true);
    expect(result.reason).toContain('inconclusive');
    expect(result.reason).toContain('HTTP 404');
  });

  it('keeps 403 as a failed check', async () => {
    await installClaude();
    const fetch = vi.fn(async () => jsonResponse(403, { error: { message: 'forbidden' } }));

    const result = await checkAgentCredential(
      { provider: 'claude-code' },
      { fetch, now: () => NOW, rootDir },
    );

    expect(result).toMatchObject({ installed: true, ok: false });
  });

  it('reports an expired Claude Code token without a network call', async () => {
    await installClaude('2026-05-01T00:00:00.000Z');
    const fetch = vi.fn();

    const result = await checkAgentCredential(
      { provider: 'claude-code' },
      { fetch, now: () => NOW, rootDir },
    );

    expect(result).toMatchObject({ expiresAt: '2026-05-01T00:00:00.000Z', ok: false });
    expect(result.reason).toContain('expired');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('confirms a Codex login through the usage endpoint', async () => {
    await installAgentCredential(
      {
        provider: 'codex',
        secret: {
          authJson: JSON.stringify({ tokens: { access_token: ACCESS, account_id: 'acct-1' } }),
          type: 'codex-auth-json',
        },
      },
      { rootDir },
    );
    const fetch = vi.fn(async () => jsonResponse(200, { rate_limit: {} }));

    const result = await checkAgentCredential(
      { provider: 'codex' },
      { fetch, now: () => NOW, rootDir },
    );

    expect(result).toMatchObject({ installed: true, ok: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect(init.headers).toMatchObject({
      'Authorization': `Bearer ${ACCESS}`,
      'ChatGPT-Account-Id': 'acct-1',
    });
  });

  it('flags a rejected Codex login and notes a refreshable expired access token', async () => {
    const expiredJwt = `h.${Buffer.from(JSON.stringify({ exp: NOW / 1000 - 60 })).toString('base64url')}.s`;
    await installAgentCredential(
      {
        provider: 'codex',
        secret: {
          authJson: JSON.stringify({
            tokens: { access_token: expiredJwt, refresh_token: 'r-123456789' },
          }),
          type: 'codex-auth-json',
        },
      },
      { rootDir },
    );
    const fetch = vi.fn(async () => jsonResponse(401, { detail: 'Unauthorized' }));

    const result = await checkAgentCredential(
      { provider: 'codex' },
      { fetch, now: () => NOW, rootDir },
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('HTTP 401');
    expect(result.reason).toContain('refresh token');
    expect(result.reason).not.toContain(expiredJwt);
  });

  it('does not leak the token when the network call itself fails', async () => {
    await installClaude();
    const fetch = vi.fn(async () => {
      throw new Error(`connect failed for Bearer ${TOKEN}`);
    });

    const result = await checkAgentCredential(
      { provider: 'claude-code' },
      { fetch, now: () => NOW, rootDir },
    );

    expect(result.ok).toBe(false);
    expect(result.reason).not.toContain(TOKEN);
  });
});
