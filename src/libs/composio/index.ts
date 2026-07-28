import {
  Composio,
  ComposioConnectedAccountNotFoundError,
  ConnectedAccountErrorCodes,
} from '@composio/core';
import { toRecord } from '@lobechat/utils/object';

import { getServerComposioApiKey } from '@/config/composio';

let composioClientInstance: { apiKey: string; client: Composio } | undefined;

/**
 * Identifies the two not-found error shapes emitted by Composio connected-account operations.
 *
 * Use when:
 * - `tools.execute` emits the normalized Composio error class
 * - `connectedAccounts.get` exposes the generated API client's top-level HTTP status
 *
 * Expects:
 * - The error was thrown by an operation targeting a known connected account
 *
 * Returns:
 * - `true` only for the concrete connected-account error or a direct HTTP 404
 */
export const isComposioConnectedAccountNotFoundError = (error: unknown): boolean => {
  if (error instanceof ComposioConnectedAccountNotFoundError) return true;

  const record = toRecord(error);
  if (!record) return false;
  if (record.code === ConnectedAccountErrorCodes.CONNECTED_ACCOUNT_NOT_FOUND) return true;
  if (record.name === 'ComposioConnectedAccountNotFoundError') return true;

  return record.status === 404 || record.statusCode === 404;
};

export const getComposioClient = (): Composio => {
  const apiKey = getServerComposioApiKey();

  if (!apiKey) {
    throw new Error('Composio API key is not configured on server');
  }

  if (!composioClientInstance || composioClientInstance.apiKey !== apiKey) {
    composioClientInstance = {
      apiKey,
      client: new Composio({ apiKey }),
    };
  }

  return composioClientInstance.client;
};

export const isComposioClientAvailable = (): boolean => {
  return !!getServerComposioApiKey();
};
