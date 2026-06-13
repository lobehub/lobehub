import type {
  ChatCompletionErrorPayload,
  ILobeAgentRuntimeErrorType,
} from '@lobechat/model-runtime';
import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { ChatErrorType, type ErrorType } from '@lobechat/types';
import { NextResponse } from 'next/server';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { createErrorResponse } from '@/utils/errorResponse';

import { resolveValidWorkspaceIdFromRequest } from '../../_utils/workspace';

const MAX_ERROR_DEPTH = 4;

const SENSITIVE_ERROR_FIELDS = new Set([
  'authorization',
  'headers',
  'key',
  'password',
  'request',
  'secret',
  'stack',
  'token',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isSensitiveField = (key: string) => {
  const normalizedKey = key.toLowerCase().replaceAll(/[-_\s]/g, '');

  return (
    SENSITIVE_ERROR_FIELDS.has(normalizedKey) ||
    normalizedKey.includes('apikey') ||
    normalizedKey.includes('authorization') ||
    normalizedKey.includes('credential') ||
    normalizedKey.includes('secret') ||
    normalizedKey.includes('token')
  );
};

const toJsonSafeValue = (value: unknown, seen = new WeakSet<object>(), depth = 0): unknown => {
  if (value === null) return null;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return;
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    if (depth >= MAX_ERROR_DEPTH) return '[Truncated]';

    seen.add(value);

    return value.map((item) => toJsonSafeValue(item, seen, depth + 1) ?? null);
  }

  if (!isRecord(value)) return String(value);
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_ERROR_DEPTH) return '[Truncated]';

  seen.add(value);

  if (value instanceof Error) {
    const errorValue: Record<string, unknown> = {
      message: value.message,
      name: value.name,
    };

    const cause = toJsonSafeValue(value.cause, seen, depth + 1);
    if (cause !== undefined) errorValue.cause = cause;

    for (const [key, fieldValue] of Object.entries(value)) {
      if (isSensitiveField(key)) continue;

      const safeValue = toJsonSafeValue(fieldValue, seen, depth + 1);
      if (safeValue !== undefined) errorValue[key] = safeValue;
    }

    return errorValue;
  }

  const result: Record<string, unknown> = {};

  for (const [key, fieldValue] of Object.entries(value)) {
    if (isSensitiveField(key)) continue;

    const safeValue = toJsonSafeValue(fieldValue, seen, depth + 1);
    if (safeValue !== undefined) result[key] = safeValue;
  }

  return result;
};

const extractModelFetchErrorMessage = (
  error: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): string | undefined => {
  if (error === null || error === undefined) return;
  if (typeof error === 'string') return error || undefined;
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return String(error);
  }
  if (!isRecord(error)) return;
  if (error instanceof Error && error.message) return error.message;
  if (seen.has(error) || depth >= MAX_ERROR_DEPTH) return;

  seen.add(error);

  const record = error as Record<string, unknown>;
  for (const key of ['error', 'body', 'cause', 'response', 'detail', 'details', 'reason']) {
    const message = extractModelFetchErrorMessage(record[key], seen, depth + 1);
    if (message) return message;
  }

  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      const message = extractModelFetchErrorMessage(item, seen, depth + 1);
      if (message) return message;
    }
  }

  if (typeof record.message === 'string' && record.message) return record.message;
  if (typeof record.status === 'number') return `HTTP ${record.status}`;
  if (typeof record.statusCode === 'number') return `HTTP ${record.statusCode}`;
};

const createModelListErrorResponse = (
  provider: string,
  e: unknown,
  fallbackErrorType: ErrorType | ILobeAgentRuntimeErrorType,
  options: { usePayloadErrorType?: boolean } = {},
) => {
  const errorPayload = isRecord(e) ? (e as Partial<ChatCompletionErrorPayload>) : undefined;
  const errorType =
    options.usePayloadErrorType === false
      ? fallbackErrorType
      : errorPayload?.errorType || fallbackErrorType;
  const error = errorPayload?.error || e;
  const message = extractModelFetchErrorMessage(error) || errorPayload?.message;

  console.error(`Route: [${provider}] ${errorType}:`, error);

  return createErrorResponse(errorType, {
    error: toJsonSafeValue(error),
    message,
    provider,
  });
};

export const GET = checkAuth(async (req, { params, userId, serverDB }) => {
  const provider = (await params)!.provider!;

  let agentRuntime: Awaited<ReturnType<typeof initModelRuntimeFromDB>>;
  try {
    const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });

    // Read user's provider config from database
    agentRuntime = await initModelRuntimeFromDB(serverDB, userId, provider, workspaceId);
  } catch (e) {
    return createModelListErrorResponse(provider, e, ChatErrorType.InternalServerError);
  }

  try {
    const list = await agentRuntime.models();

    return NextResponse.json(list);
  } catch (e) {
    return createModelListErrorResponse(provider, e, AgentRuntimeErrorType.ProviderBizError, {
      usePayloadErrorType: false,
    });
  }
});
