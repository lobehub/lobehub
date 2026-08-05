import { lambdaClient } from '@/libs/trpc/client';

import { getAicoBillingContext, setAicoBillingContext } from './store';
import {
  type AicoBillingContext,
  type AicoBillingSourcesResponse,
  preferenceToBillingContext,
} from './types';

const isManagedProvider = (provider: string): boolean =>
  provider === 'aico' || provider === 'openrouter';

/**
 * Ensure every managed chat request carries an explicit billing context.
 * Uses the in-memory selection when hydrated; otherwise loads preference once.
 */
export const resolveAicoBillingForRequest = async (
  provider: string,
): Promise<AicoBillingContext | undefined> => {
  if (!isManagedProvider(provider)) return undefined;

  const cached = getAicoBillingContext();
  if (cached) return cached;

  const data =
    (await lambdaClient.aicoBilling.getMyBillingSources.query()) as AicoBillingSourcesResponse;
  const context = preferenceToBillingContext(data);
  setAicoBillingContext(context);
  return context;
};
