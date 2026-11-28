import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { CheckAgentCredentialResult, DeviceAgentCredentialProvider } from '@lobechat/types';

import { scrubAgentCredentialText } from './redact';
import {
  type AgentCredentialStoreOptions,
  hasInstalledAgentCredential,
  isAgentCredentialExpired,
  parseAgentCredentialProviderParams,
  parseInstallAgentCredentialParams,
  readInstalledAgentCredential,
} from './store';

/**
 * Claude probe: token counting is authenticated like inference but runs no
 * model and is not billed against usage, and it accepts the inference-only
 * scope that long-lived Claude Code OAuth tokens carry. The quota sampler's
 * `/api/oauth/usage` needs the profile scope those tokens may lack, so it
 * would report a working token as broken.
 */
const CLAUDE_CREDENTIAL_CHECK_URL = 'https://api.anthropic.com/v1/messages/count_tokens';
const CLAUDE_CREDENTIAL_CHECK_MODEL = 'claude-haiku-5-5';
/**
 * Subscription OAuth tokens are issued for Claude Code; the probe identifies
 * itself the way the CLI does so the API judges the token, not the caller.
 */
const CLAUDE_CODE_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

/**
 * Codex probe: the same ChatGPT backend usage read the Codex CLI makes for its
 * rate-limit status; it reads limits and spends none.
 */
const CODEX_CREDENTIAL_CHECK_URL = 'https://chatgpt.com/backend-api/wham/usage';
/** An `auth.json` holding only an API key: listing models is free. */
const OPENAI_API_KEY_CHECK_URL = 'https://api.openai.com/v1/models';

const CHECK_TIMEOUT_MS = 15_000;
const REASON_MAX_LENGTH = 300;

export interface CheckAgentCredentialOptions extends AgentCredentialStoreOptions {
  /** Injected in tests so they never reach the network. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface ProbeResult {
  ok: boolean;
  reason?: string;
}

/** Pull the provider's error message out of a failed response, never the request. */
const describeFailure = async (response: Response, secrets: string[]): Promise<string> => {
  let detail = '';
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown; type?: unknown } | string;
      detail?: unknown;
      message?: unknown;
    };
    const error = body?.error;
    const message =
      typeof error === 'object' && error ? error.message : (error ?? body?.detail ?? body?.message);
    if (typeof message === 'string') detail = message;
  } catch {
    // Not JSON: the status says enough.
  }
  const status = `HTTP ${response.status}`;
  const text = detail ? `${status}: ${detail}` : status;
  return scrubAgentCredentialText(text, undefined, secrets).slice(0, REASON_MAX_LENGTH);
};

const runProbe = async (
  request: () => Promise<Response>,
  secrets: string[],
  rejectedReason: string,
): Promise<ProbeResult> => {
  let response: Response;
  try {
    response = await request();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: `Could not reach the provider to check the credential: ${scrubAgentCredentialText(message, undefined, secrets)}`,
    };
  }
  if (response.ok) return { ok: true };
  const failure = await describeFailure(response, secrets);
  // Rate limiting happens after authentication: the credential itself works.
  if (response.status === 429) return { ok: true, reason: `Rate limited (${failure})` };
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: `${rejectedReason} (${failure})` };
  }
  // Any other 4xx came after authentication (e.g. a retired probe model):
  // the credential works, only this check could not complete.
  if (response.status >= 400 && response.status < 500) {
    return {
      ok: true,
      reason: `Credential authenticated; the check request itself was refused, so this result is inconclusive (${failure})`,
    };
  }
  return { ok: false, reason: `The provider could not check the credential (${failure})` };
};

const probeClaude = (token: string, options: CheckAgentCredentialOptions) =>
  runProbe(
    () =>
      (options.fetch ?? fetch)(CLAUDE_CREDENTIAL_CHECK_URL, {
        body: JSON.stringify({
          messages: [{ content: 'ping', role: 'user' }],
          model: CLAUDE_CREDENTIAL_CHECK_MODEL,
          system: CLAUDE_CODE_SYSTEM_PROMPT,
        }),
        headers: {
          'Authorization': `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: AbortSignal.timeout(options.timeoutMs ?? CHECK_TIMEOUT_MS),
      }),
    [token],
    'Anthropic rejected the Claude Code credential',
  );

interface CodexAuthFile {
  OPENAI_API_KEY?: unknown;
  tokens?: { access_token?: unknown; account_id?: unknown; refresh_token?: unknown };
}

/** `exp` of a JWT access token, if it has one. Only the payload is decoded. */
const jwtExpiry = (token: string): number | undefined => {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
};

const probeCodex = async (
  codexHome: string,
  options: CheckAgentCredentialOptions,
): Promise<ProbeResult> => {
  let auth: CodexAuthFile;
  try {
    // Read the live file: Codex refreshes the login in place while it runs.
    auth = JSON.parse(await readFile(path.join(codexHome, 'auth.json'), 'utf8')) as CodexAuthFile;
  } catch {
    return { ok: false, reason: 'The installed Codex auth.json is unreadable. Reinstall it.' };
  }
  const doFetch = options.fetch ?? fetch;
  const signal = () => AbortSignal.timeout(options.timeoutMs ?? CHECK_TIMEOUT_MS);

  const accessToken = auth.tokens?.access_token;
  if (typeof accessToken === 'string' && accessToken) {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'OpenAI-Beta': 'codex-1',
      'User-Agent': 'codex-cli',
      'originator': 'LobeHub',
    };
    if (typeof auth.tokens?.account_id === 'string' && auth.tokens.account_id) {
      headers['ChatGPT-Account-Id'] = auth.tokens.account_id;
    }
    const secrets = [accessToken];
    if (typeof auth.tokens?.refresh_token === 'string') secrets.push(auth.tokens.refresh_token);
    const result = await runProbe(
      () => doFetch(CODEX_CREDENTIAL_CHECK_URL, { headers, method: 'GET', signal: signal() }),
      secrets,
      'ChatGPT rejected the Codex credential',
    );
    if (result.ok) return result;
    // The access token is short-lived; Codex renews it from the refresh token
    // on its next run, which this check cannot do without spending a refresh.
    const expiry = jwtExpiry(accessToken);
    const now = options.now?.() ?? Date.now();
    if (expiry !== undefined && expiry <= now && typeof auth.tokens?.refresh_token === 'string') {
      return {
        ok: false,
        reason: `${result.reason}. The access token expired at ${new Date(expiry).toISOString()}; Codex renews it from the stored refresh token on its next run, so this may recover.`,
      };
    }
    return result;
  }

  const apiKey = auth.OPENAI_API_KEY;
  if (typeof apiKey === 'string' && apiKey) {
    return runProbe(
      () =>
        doFetch(OPENAI_API_KEY_CHECK_URL, {
          headers: { Authorization: `Bearer ${apiKey}` },
          method: 'GET',
          signal: signal(),
        }),
      [apiKey],
      'OpenAI rejected the Codex API key',
    );
  }

  return { ok: false, reason: 'The installed Codex auth.json holds no login or API key.' };
};

/**
 * Check a secret the server sent instead of the installed one (a credential it
 * hands runs rather than installing). The store is never read or changed;
 * `installed` still reports whether one is on disk.
 */
const checkGivenSecret = async (
  params: unknown,
  provider: DeviceAgentCredentialProvider,
  checkedAt: string,
  now: number,
  options: CheckAgentCredentialOptions,
): Promise<CheckAgentCredentialResult> => {
  const installed = await hasInstalledAgentCredential(provider, options).catch(() => false);
  const base = { checkedAt, checkedProvidedSecret: true as const, installed };
  if (provider !== 'claude-code') {
    return {
      ...base,
      ok: false,
      reason: 'Checking a Codex credential that is not installed is not supported.',
    };
  }
  // Same validation as an install; its errors name the bad field, never the value.
  const { secret } = parseInstallAgentCredentialParams(params);
  if (secret.type !== 'claude-oauth-token') {
    return { ...base, ok: false, reason: 'Unsupported secret type.' };
  }
  const { expiresAt } = secret;
  if (isAgentCredentialExpired(expiresAt, now)) {
    return {
      ...base,
      expiresAt,
      ok: false,
      reason: `The credential expired at ${expiresAt}.`,
    };
  }
  const probe = await probeClaude(secret.token, options);
  return { ...base, expiresAt, ...probe };
};

/**
 * Prove the installed credential is usable without spending model quota.
 * Never throws for a provider-side failure: `ok: false` carries the reason.
 */
export const checkAgentCredential = async (
  params: unknown,
  options: CheckAgentCredentialOptions,
): Promise<CheckAgentCredentialResult> => {
  const { provider } = parseAgentCredentialProviderParams(params);
  const now = options.now?.() ?? Date.now();
  const checkedAt = new Date(now).toISOString();

  if ((params as { secret?: unknown }).secret !== undefined) {
    return checkGivenSecret(params, provider, checkedAt, now, options);
  }

  const credential = await readInstalledAgentCredential(provider, options);
  if (credential.status === 'missing') {
    return {
      checkedAt,
      installed: false,
      ok: false,
      reason: 'No credential is installed for this provider on this device.',
    };
  }
  if (credential.status === 'invalid') {
    return {
      checkedAt,
      installed: true,
      ok: false,
      reason: 'The installed credential is unreadable. Reinstall it.',
    };
  }

  if (credential.provider === 'claude-code') {
    const { expiresAt } = credential;
    if (isAgentCredentialExpired(expiresAt, now)) {
      return {
        checkedAt,
        expiresAt,
        installed: true,
        ok: false,
        reason: `The credential expired at ${expiresAt}.`,
      };
    }
    const probe = await probeClaude(credential.token, options);
    return { checkedAt, expiresAt, installed: true, ...probe };
  }

  const probe = await probeCodex(credential.codexHome, options);
  return { checkedAt, installed: true, ...probe };
};
