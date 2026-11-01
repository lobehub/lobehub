import {
  Composio,
  ComposioConnectedAccountNotFoundError,
  ConnectedAccountErrorCodes,
} from '@composio/core';
import { toRecord } from '@lobechat/utils/object';

import { getServerComposioApiKey } from '@/config/composio';

let composioClientInstance: { apiKey: string; client: Composio } | undefined;

/**
 * Identifies an explicit Composio connected-account-not-found error.
 *
 * Use when:
 * - `tools.execute` emits the normalized Composio error class or code
 *
 * Expects:
 * - The SDK has already classified the failure as a missing connected account
 *
 * Returns:
 * - `true` only for the concrete connected-account error, code, or stable name
 */
export const isComposioConnectedAccountNotFoundError = (error: unknown): boolean => {
  if (error instanceof ComposioConnectedAccountNotFoundError) return true;

  const record = toRecord(error);
  if (!record) return false;
  if (record.code === ConnectedAccountErrorCodes.CONNECTED_ACCOUNT_NOT_FOUND) return true;
  return record.name === 'ComposioConnectedAccountNotFoundError';
};

/**
 * Identifies a missing account at the dedicated connected-account lookup boundary.
 *
 * Use when:
 * - `connectedAccounts.get` may expose the generated API client's raw HTTP 404
 *
 * Expects:
 * - The attempted HTTP operation only retrieves a known connected-account ID
 *
 * Returns:
 * - `true` for an explicit connected-account error or a direct lookup HTTP 404
 */
export const isComposioConnectedAccountLookupNotFoundError = (error: unknown): boolean => {
  if (isComposioConnectedAccountNotFoundError(error)) return true;

  const record = toRecord(error);
  return record?.status === 404 || record?.statusCode === 404;
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
