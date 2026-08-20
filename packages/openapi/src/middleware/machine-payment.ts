import type {
  MachinePaymentPrice,
  MachinePaymentPriceParams,
} from '@lobechat/business-server/machine-payments/types';
import type { MiddlewareHandler } from 'hono';

/** Outcome of a composed mppx handler for one HTTP request. */
export type ComposedPaymentResult =
  | { challenge: Response; status: 402 }
  | { status: 200; withReceipt: (response: Response) => Response };

/**
 * Structural view of the mppx instance this middleware needs.
 *
 * Kept structural on purpose: which payment methods the instance carries
 * (Stripe SPT, Tempo stablecoin, …) is a deployment decision that belongs to
 * the layer that constructs it, not to the protocol plumbing here.
 */
export interface MachinePaymentMppx {
  compose: (
    ...entries: [string, Record<string, unknown>][]
  ) => (input: Request) => Promise<ComposedPaymentResult>;
}

export interface MachinePaymentConfig {
  /** Canonical `name/intent` key of the configured method, e.g. `stripe/charge`. */
  methodKey: string;
  mppx: MachinePaymentMppx;
  resolvePrice: (params: MachinePaymentPriceParams) => Promise<MachinePaymentPrice | null>;
}

declare module 'hono' {
  interface ContextVariableMap {
    /** True only after a challenge was answered and settled for this request. */
    machinePaymentSettled?: boolean;
    machinePaymentTier?: 'free' | 'paid' | 'unpriced';
  }
}

const routeOf = (method: string, url: string) => `${method} ${new URL(url).pathname}`;

/**
 * Gates a route behind the Machine Payments Protocol (HTTP 402).
 *
 * Three outcomes, decided entirely by `resolvePrice`:
 *
 * - `null` — the route is not for sale. No challenge is issued and nothing is
 *   settled; the request falls through untouched so the normal auth chain
 *   still governs it. This is the open-source default.
 * - amount `'0'` — metered free tier. The caller must still answer the
 *   challenge with an identity proof, but no money moves.
 * - any other amount — the caller pays before the handler runs.
 *
 * The middleware never grants access on its own. It only *records* that a
 * payment settled, via `machinePaymentSettled`. Pair it with
 * {@link requirePaymentOr} so an unpriced route stays behind authentication
 * instead of silently becoming public.
 */
export const machinePayment = (config: MachinePaymentConfig): MiddlewareHandler => {
  const { methodKey, mppx, resolvePrice } = config;

  return async (c, next) => {
    const route = routeOf(c.req.method, c.req.url);
    const price = await resolvePrice({ route });

    if (!price) {
      c.set('machinePaymentTier', 'unpriced');
      return next();
    }

    const result = await mppx.compose([
      methodKey,
      {
        amount: price.amount,
        currency: price.currency,
        // Binds the challenge to this route, so a credential minted for one
        // endpoint cannot be replayed against another.
        scope: route,
        ...(price.recipient ? { recipient: price.recipient } : {}),
      },
    ])(c.req.raw);

    if (result.status === 402) return result.challenge;

    c.set('machinePaymentTier', price.amount === '0' ? 'free' : 'paid');
    c.set('machinePaymentSettled', true);

    await next();

    c.res = result.withReceipt(c.res);
  };
};

/**
 * Fail-closed bridge between payment and authentication.
 *
 * Skips `fallback` only when {@link machinePayment} actually settled a payment
 * for this request. When no price was configured — the open-source default —
 * nothing settles, so `fallback` runs and the route keeps exactly the
 * protection it has today. Getting this default backwards would turn every
 * self-hosted deployment's API into an open endpoint.
 */
export const requirePaymentOr =
  (fallback: MiddlewareHandler): MiddlewareHandler =>
  async (c, next) =>
    c.get('machinePaymentSettled') === true ? next() : fallback(c, next);
