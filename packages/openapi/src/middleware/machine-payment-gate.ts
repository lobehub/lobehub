import type { MiddlewareHandler } from 'hono';

import { getPaymentRail } from '@/business/server/machine-payments/getPaymentRail';
import { recordPayment } from '@/business/server/machine-payments/recordPayment';
import { resolvePrice } from '@/business/server/machine-payments/resolvePrice';

import { machinePayment } from './machine-payment';

const passThrough: MiddlewareHandler = async (_c, next) => next();

/**
 * `machinePayment` wired to this deployment's rail, pricing and ledger.
 *
 * Without a rail (the open-source default) it passes every request through, so
 * a route mounted behind `machinePaymentGate()` + `requirePaymentOr(requireAuth)`
 * behaves exactly like a plain `requireAuth` route.
 *
 * The rail is built on the first request rather than at import time: building
 * it may read secrets and construct payment clients, which should not happen
 * just because the route module was loaded.
 */
export const machinePaymentGate = (): MiddlewareHandler => {
  let gate: MiddlewareHandler | undefined;

  return (c, next) => {
    if (!gate) {
      const rail = getPaymentRail();
      gate = rail ? machinePayment({ ...rail, recordPayment, resolvePrice }) : passThrough;
    }

    return gate(c, next);
  };
};

/** Whether this deployment can collect payment at all. */
export const canCollectPayment = (): boolean => getPaymentRail() !== null;
