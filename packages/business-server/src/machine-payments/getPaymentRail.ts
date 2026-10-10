import type { MachinePaymentRail } from './types';

/**
 * Returns the payment rail this deployment collects through, or `null` when it
 * sells nothing.
 *
 * Open-source stub: `null`. Payable routes then mount no payment middleware at
 * all and stay behind normal authentication, exactly as before. Cloud overrides
 * this to construct its mppx instance; self-hosters can override it to sell
 * their own instance.
 *
 * Called once per process, on the first request to a payable route, so an
 * implementation may read secrets and build clients here.
 */
export function getPaymentRail(): MachinePaymentRail | null {
  return null;
}
