import type { ToolCallHookExecutionResult } from '@lobechat/types';
import {
  AGENT_HOOK_RESPONSE_MAX_BYTES,
  agentHookWebhookSchema,
  parseToolCallHookResponse,
} from '@lobechat/types';
import { readBlobWithLimit } from '@lobechat/utils/readBlobWithLimit';
import { QstashError } from '@upstash/qstash';

import { OtelQstashClient } from '@/libs/qstash';

import type { AgentHookWebhook } from './types';

class HookHttpError extends Error {
  readonly status?: number;

  constructor(
    public readonly code:
      | 'configuration'
      | 'http_error'
      | 'invalid_response'
      | 'network_error'
      | 'response_too_large'
      | 'timeout',
    diagnostic?: { message: string; status?: number },
  ) {
    super(`Hook HTTP request failed: ${code}${diagnostic ? `: ${diagnostic.message}` : ''}`);
    this.name = 'HookHttpError';
    this.status = diagnostic?.status;
  }
}

/**
 * Resolve a webhook URL against the base the *receiver* can reach.
 *
 * QStash deliveries are relayed by the QStash service (Upstash cloud or a
 * self-hosted container), which typically cannot reach this process's loopback
 * — in Compose-style deployments INTERNAL_APP_URL is exactly that. Those must
 * carry an APP_URL the relay resolves (host-gateway, public origin). Plain
 * fetch fires from this process itself, so the internal address is preferred
 * there to keep server-to-server traffic off the public path.
 */
function resolveUrl(url: string, delivery: AgentHookWebhook['delivery']): string {
  const base =
    delivery === 'qstash'
      ? process.env.APP_URL || process.env.INTERNAL_APP_URL
      : process.env.INTERNAL_APP_URL || process.env.APP_URL;
  try {
    const resolved = new URL(url, base || undefined);
    if (
      !['http:', 'https:'].includes(resolved.protocol) ||
      resolved.username ||
      resolved.password
    ) {
      throw new Error('Invalid webhook configuration');
    }
    return resolved.href;
  } catch {
    throw new HookHttpError('configuration');
  }
}

function isApplicationOrigin(url: string): boolean {
  return [process.env.INTERNAL_APP_URL, process.env.APP_URL].some((base) => {
    if (!base) return false;
    try {
      return new URL(base).origin === new URL(url).origin;
    } catch {
      return false;
    }
  });
}

/** Only explicitly allowlisted variables are expanded; errors never contain their values. */
export function resolveWebhookHeaders(webhook: AgentHookWebhook): Record<string, string> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const allowed = new Set(webhook.allowedEnvVars ?? []);
  try {
    for (const [name, template] of Object.entries(webhook.headers ?? {})) {
      if (
        /^(?:host|content-length|connection|transfer-encoding|trailer|upgrade|proxy-.*|sec-.*|upstash-.*)$/i.test(
          name,
        )
      ) {
        throw new Error('Invalid webhook configuration');
      }
      const value = template.replaceAll(/\$\{([^}]*)\}/g, (_, variable: string) => {
        if (!allowed.has(variable) || process.env[variable] === undefined)
          throw new Error('Invalid webhook configuration');
        return process.env[variable]!;
      });
      if (value.includes('${') || /[\r\n\0]/.test(value))
        throw new Error('Invalid webhook configuration');
      headers.set(name, value);
    }
    return Object.fromEntries(headers.entries());
  } catch {
    throw new HookHttpError('configuration');
  }
}

async function fetchWebhook<T>(
  webhook: AgentHookWebhook,
  payload: Record<string, unknown>,
  handleResponse: (response: Response, signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(Math.ceil((webhook.timeout ?? 30) * 1000));
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    combinedSignal.throwIfAborted();
    const response = await fetch(resolveUrl(webhook.url, webhook.delivery), {
      body: JSON.stringify(payload),
      headers: resolveWebhookHeaders(webhook),
      method: 'POST',
      redirect: 'error',
      signal: combinedSignal,
    });
    combinedSignal.throwIfAborted();
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel();
      throw new HookHttpError('http_error');
    }
    return await handleResponse(response, combinedSignal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new HookHttpError('timeout');
    if (error instanceof HookHttpError) throw error;
    throw new HookHttpError('network_error');
  }
}

async function discardNotificationBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A cleanup failure must not turn an accepted notification into a retry.
    console.error('[HookDispatcher] Failed to discard notification response body');
  }
}

async function readControlBody(response: Response, signal: AbortSignal): Promise<ArrayBuffer> {
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new HookHttpError('invalid_response');
  }
  const body = await readBlobWithLimit(response, AGENT_HOOK_RESPONSE_MAX_BYTES).catch(
    (error: unknown) => {
      if (error instanceof RangeError) throw new HookHttpError('response_too_large');
      throw error;
    },
  );
  const buffer = await body.arrayBuffer();
  signal.throwIfAborted();
  return buffer;
}

/** Notification transport. A control config must never be sent through a response-ignoring path. */
export async function deliverWebhook(
  webhook: AgentHookWebhook,
  payload: Record<string, unknown>,
): Promise<void> {
  const parsed = agentHookWebhookSchema.safeParse(webhook);
  if (!parsed.success || webhook.responseHandling === 'toolCall')
    throw new HookHttpError('configuration');
  if (webhook.delivery !== 'qstash') {
    await fetchWebhook(webhook, payload, discardNotificationBody);
    return;
  }

  const url = resolveUrl(webhook.url, 'qstash');
  const headers = resolveWebhookHeaders(webhook);
  try {
    if (!process.env.QSTASH_TOKEN)
      throw new HookHttpError('configuration', { message: 'QSTASH_TOKEN not available' });
    const client = new OtelQstashClient({ token: process.env.QSTASH_TOKEN });
    await client.publishJSON({
      body: payload,
      headers: {
        ...headers,
        ...(isApplicationOrigin(url) &&
          process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
            'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          }),
      },
      timeout: webhook.timeout ?? 30,
      url,
    });
  } catch (error) {
    // Keep safe diagnostics, never the SDK message/cause, headers or remote response text.
    const status = error instanceof QstashError ? error.status : undefined;
    const failure =
      error instanceof HookHttpError
        ? error
        : status !== undefined
          ? new HookHttpError('http_error', {
              message: `QStash publish failed (HTTP ${status})`,
              status,
            })
          : new HookHttpError('network_error', { message: 'QStash publish failed' });
    if (webhook.fallback === 'none') throw failure;
    console.error('[HookDispatcher] QStash delivery failed, falling back to fetch', failure);
    // The fallback fires from this process itself, so it resolves against the
    // direct base — not the relay's URL. A deployment that sets INTERNAL_APP_URL
    // precisely because the server cannot reach its own public address would
    // fail the fallback exactly when QStash is unavailable, the one moment the
    // fallback exists for.
    await fetchWebhook({ ...webhook, delivery: 'fetch' }, payload, discardNotificationBody);
  }
}

/**
 * C1 preparation primitive. No retries, side effects on tools, or application of decisions.
 * The caller supplies the full authoritative event and handles cancellation before onError.
 */
export async function executeToolCallWebhook(
  webhook: AgentHookWebhook,
  payload: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
): Promise<ToolCallHookExecutionResult> {
  if (options.signal?.aborted) return { status: 'cancelled' };
  const parsed = agentHookWebhookSchema.safeParse(webhook);
  if (!parsed.success || webhook.responseHandling !== 'toolCall') {
    return { code: 'configuration', status: 'error' };
  }
  try {
    const body = await fetchWebhook(parsed.data, payload, readControlBody, options.signal);
    if (options.signal?.aborted) return { status: 'cancelled' };
    try {
      return parseToolCallHookResponse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    } catch {
      return { code: 'invalid_response', status: 'error' };
    }
  } catch (error) {
    if (options.signal?.aborted) return { status: 'cancelled' };
    return { code: error instanceof HookHttpError ? error.code : 'network_error', status: 'error' };
  }
}
