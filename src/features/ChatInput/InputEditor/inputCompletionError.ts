import { AgentRuntimeErrorType } from '@lobechat/types';
import { isRecord } from '@lobechat/utils';

import type { InputCompletionError } from '../store/initialState';

const getRecordField = (record: Record<PropertyKey, unknown> | undefined, key: string) => {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
};

const getStringField = (record: Record<PropertyKey, unknown> | undefined, key: string) => {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
};

const getNumberField = (record: Record<PropertyKey, unknown> | undefined, key: string) => {
  const value = record?.[key];
  return typeof value === 'number' ? value : undefined;
};

export const isInputCompletionAbortError = (error: unknown): boolean => {
  const record = isRecord(error) ? error : undefined;
  const cause = getRecordField(record, 'cause');
  const message = getStringField(record, 'message') ?? '';
  const causeMessage = getStringField(cause, 'message') ?? '';
  const normalizedMessage = `${message} ${causeMessage}`.toLowerCase();

  return (
    getStringField(record, 'name') === 'AbortError' ||
    getStringField(cause, 'name') === 'AbortError' ||
    normalizedMessage.includes('aborted') ||
    normalizedMessage.includes('aborterror') ||
    normalizedMessage.includes('signal is aborted without reason')
  );
};

const CREDENTIAL_ERROR_TYPES = new Set<string>([
  AgentRuntimeErrorType.InvalidBedrockCredentials,
  AgentRuntimeErrorType.InvalidGithubToken,
  AgentRuntimeErrorType.InvalidProviderAPIKey,
  AgentRuntimeErrorType.InvalidVertexCredentials,
  AgentRuntimeErrorType.NoOpenAIAPIKey,
]);

/**
 * tRPC maps a runtime failure onto a transport code (`UNAUTHORIZED`,
 * `BAD_REQUEST`, ...) and keeps the runtime error type only in the message --
 * see `createRuntimeTRPCError` in `apps/server/src/routers/lambda/aiChat.ts`.
 * Classifying on the transport code alone drops the credential signal, so a
 * workspace that has no key for the personal provider would never fall back to
 * the default completion model. Recover the runtime type before classifying.
 */
const resolveErrorType = (
  record: Record<PropertyKey, unknown> | undefined,
  data: Record<PropertyKey, unknown> | undefined,
  errorData: Record<PropertyKey, unknown> | undefined,
): string | undefined => {
  const bodyType = getStringField(errorData, 'errorType');

  if (bodyType) return bodyType;

  const messages = [
    getStringField(record, 'message'),
    getStringField(getRecordField(record, 'cause'), 'message'),
  ];
  const credentialType = messages.find(
    (candidate): candidate is string => !!candidate && CREDENTIAL_ERROR_TYPES.has(candidate),
  );

  if (credentialType) return credentialType;

  return getStringField(data, 'code') ?? getStringField(record, 'message');
};

export const createInputCompletionError = (error: unknown): InputCompletionError => {
  const record = isRecord(error) ? error : undefined;
  const data = getRecordField(record, 'data');
  const errorData = getRecordField(data, 'errorData');
  const message = getStringField(record, 'message') ?? 'Input completion failed';

  return {
    body: errorData,
    errorType: resolveErrorType(record, data, errorData),
    httpStatus: getNumberField(data, 'httpStatus'),
    message,
  };
};

/**
 * Whether a failed completion means the chosen provider has no usable
 * credentials in the current scope (missing or rejected API key), as opposed
 * to budget, rate-limit or upstream failures.
 */
export const isInputCompletionCredentialError = (error: InputCompletionError): boolean =>
  !!error.errorType && CREDENTIAL_ERROR_TYPES.has(error.errorType);
