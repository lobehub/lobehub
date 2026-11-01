import { MarketAPIError } from '@lobehub/market-sdk';
import debug from 'debug';

import { loadModels } from '@/business/client/model-bank/loadModels';

export const log = debug('lobe-server:discover');

export const isMarketNotFound = (error: unknown) =>
  error instanceof MarketAPIError && (error.status === 404 || error.isErrorCode('NOT_FOUND'));

export const loadBuiltinModels = async () => loadModels();

export const normalizeAuthorField = (
  author: unknown,
): { name: string; ownerType?: 'user' | 'organization'; userName?: string } => {
  if (!author) return { name: '' };

  if (typeof author === 'string') return { name: author };

  if (typeof author === 'object') {
    const { avatar, url, name, userName, type } = author as {
      avatar?: unknown;
      name?: unknown;
      type?: unknown;
      url?: unknown;
      userName?: unknown;
    };

    const authorName =
      (typeof name === 'string' && name.length > 0 && name) ||
      (typeof avatar === 'string' && avatar.length > 0 && avatar) ||
      (typeof url === 'string' && url.length > 0 && url) ||
      '';

    return {
      name: authorName,
      ownerType: type === 'organization' ? 'organization' : 'user',
      userName: typeof userName === 'string' ? userName : undefined,
    };
  }

  return { name: '' };
};
