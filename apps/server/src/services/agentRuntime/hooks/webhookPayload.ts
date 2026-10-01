import type { AgentHookType, ToolRunResult } from '@lobechat/agent-runtime';
import { redactResultForEvents } from '@lobechat/agent-runtime';

import { UserModel } from '@/database/models/user';
import { getServerDB } from '@/database/server';

import type { AgentHookWebhook, AgentHookWebhookPayload } from './types';

const EMAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const EMAIL_CACHE_CAPACITY = 1000;

/** Email is optional enrichment; database failures must not suppress the hook. */
const readUserEmail = async (userId: string): Promise<string | undefined> => {
  try {
    const users = await UserModel.getEmailsByIds(await getServerDB(), [userId]);
    return users.find((user) => user.id === userId)?.email ?? undefined;
  } catch {
    console.error('[HookDispatcher] Failed to resolve webhook user email');
    return undefined;
  }
};

/** Allow each waiter to cancel independently; query timeouts belong to the database. */
const waitForEmail = (value: Promise<string | undefined>, signal?: AbortSignal) => {
  if (signal?.aborted) return Promise.resolve(undefined);
  if (!signal) return value;
  return new Promise<string | undefined>((resolve) => {
    const finish = (email?: string) => {
      signal.removeEventListener('abort', onAbort);
      resolve(email);
    };
    const onAbort = () => finish();
    signal.addEventListener('abort', onAbort, { once: true });
    void value.then(finish);
  });
};

/**
 * Per-dispatcher bounded cache, including pending lookups and missing emails.
 * Workers resolve independently; this is a five-minute delivery-time cache,
 * not a persisted run identity snapshot.
 */
const createCachedLookup = (read: (key: string) => Promise<string | undefined>) => {
  const entries = new Map<string, { expiresAt: number; value: Promise<string | undefined> }>();
  return (key: string) => {
    const now = Date.now();
    const cached = entries.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    entries.delete(key);
    if (entries.size >= EMAIL_CACHE_CAPACITY) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    const value = read(key);
    entries.set(key, { expiresAt: now + EMAIL_CACHE_TTL_MS, value });
    return value;
  };
};

export const createWebhookPayloadBuilder = () => {
  const resolveEmail = createCachedLookup(readUserEmail);

  return async <T extends { userId?: string }>(
    event: T,
    webhook: Pick<AgentHookWebhook, 'body' | 'eventFields'>,
    metadata: { hookId: string; hookType: AgentHookType },
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentHookWebhookPayload | undefined> => {
    const { signal } = options;
    if (signal?.aborted) return undefined;
    const { body, eventFields } = webhook;
    const selected: Record<string, unknown> = eventFields ? {} : { ...event };
    if (eventFields) {
      for (const field of eventFields) {
        if (field in event) selected[field] = event[field as keyof T];
      }
    }
    const payload: AgentHookWebhookPayload = { ...selected, ...metadata, ...body };
    if (metadata.hookType === 'afterToolCall' && payload.result) {
      payload.result = redactResultForEvents(payload.result as ToolRunResult);
    }
    delete payload.finalState;
    delete payload.userEmail;
    const userId = 'userId' in payload ? payload.userId : event.userId;
    if (
      (!eventFields || eventFields.includes('userEmail')) &&
      typeof userId === 'string' &&
      userId
    ) {
      const email = await waitForEmail(resolveEmail(userId), signal);
      if (signal?.aborted) return undefined;
      if (email !== undefined) payload.userEmail = email;
    }
    return payload;
  };
};
