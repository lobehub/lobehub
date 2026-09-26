import type { MachinePaymentPrice, MachinePaymentPriceParams } from './types';

/**
 * Resolves the price for a machine-payable route.
 *
 * Open-source stub: returns `null`, meaning "this route is not for sale". The
 * middleware then issues no challenge and settles nothing, so a self-hosted
 * deployment keeps its current behaviour — every route stays behind normal
 * auth. Cloud overrides this with real pricing; self-hosters can override it
 * to sell their own instance.
 *
 * Returning an amount of `'0'` prices the route as a *metered free tier*: the
 * caller still has to answer the challenge with an identity proof, but no
 * money moves.
 */
export async function resolvePrice(
  _params: MachinePaymentPriceParams,
): Promise<MachinePaymentPrice | null> {
  return null;
}
