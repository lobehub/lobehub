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

export const createInputCompletionError = (error: unknown): InputCompletionError => {
  const record = isRecord(error) ? error : undefined;
  const data = getRecordField(record, 'data');
  const errorData = getRecordField(data, 'errorData');
  const message = getStringField(record, 'message') ?? 'Input completion failed';

  return {
    body: errorData,
    errorType:
      getStringField(errorData, 'errorType') ??
      getStringField(data, 'code') ??
      getStringField(record, 'message'),
    httpStatus: getNumberField(data, 'httpStatus'),
    message,
  };
};
