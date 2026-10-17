import debug from 'debug';
import type { MiddlewareHandler } from 'hono';
import { Credential, Receipt } from 'mppx';

import type {
  MachinePaymentMppx,
  MachinePaymentPrice,
  MachinePaymentPriceParams,
  MachinePaymentRecordParams,
} from '@/business/server/machine-payments/types';

export type {
  ComposedPaymentResult,
  MachinePaymentMppx,
} from '@/business/server/machine-payments/types';

const log = debug('lobe-hono:machine-payment');

const RECEIPT_HEADER = 'Payment-Receipt';

export interface MachinePaymentConfig {
  /** Canonical `name/intent` key of the configured method, e.g. `stripe/charge`. */
  methodKey: string;
  /**
   * Must carry replay protection. mppx core never dedupes credentials — that is
   * the payment method's job (e.g. `tempo.charge()` only protects when given a
   * `store`). Without it, one credential settles on every request that repeats
   * it.
   *
   * A method's `verify` must reject with an mppx `PaymentError` (e.g.
   * `Errors.VerificationFailedError`) to answer 402; any other throw becomes a
   * 500 `InternalPaymentError`. Official methods do not always comply — Stripe
   * throws a plain `Error` for a declined card — so wrap each method with
   * `withPaymentRejections` (./machine-payment-rejections) before `Mppx.create()`.
   */
  mppx: MachinePaymentMppx;
  /**
   * Invoked once per settlement, before the handler runs.
   *
   * Called exactly once and never retried, and a rejection is logged rather
   * than propagated — a caller who paid still gets what they bought. Durability
   * is therefore the implementation's job: make it idempotent on `reference`
   * (unique per settlement) and write through an outbox if the ledger can be
   * unavailable.
   */
  recordPayment?: (params: MachinePaymentRecordParams) => Promise<void>;
  resolvePrice: (params: MachinePaymentPriceParams) => Promise<MachinePaymentPrice | null>;
}

declare module 'hono' {
  interface ContextVariableMap {
    /** True only after a challenge was answered and settled for this request. */
    machinePaymentSettled?: boolean;
    machinePaymentTier?: 'authenticated' | 'free' | 'paid' | 'unpriced';
  }
}

const routeOf = (method: string, url: string) => `${method} ${new URL(url).pathname}`;

/**
 * Gates a route behind the Machine Payments Protocol (HTTP 402).
 *
 * Four outcomes:
 *
 * - `resolvePrice` returns `null` — the route is not for sale. No challenge is
 *   issued and nothing is settled; the request falls through untouched so the
 *   normal auth chain still governs it. This is the open-source default.
 * - the caller presents a non-Payment credential — it is asking to be
 *   authenticated, not to buy. See below.
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
  const { methodKey, mppx, recordPayment, resolvePrice } = config;

  return async (c, next) => {
    const route = routeOf(c.req.method, c.req.url);

    // A caller holding a non-Payment credential is asking to be authenticated,
    // not to buy. Challenging it would mean that pricing an existing route
    // silently *replaces* authentication: every current API-key client of that
    // route would start getting 402. Hand it to the auth chain instead — which
    // still rejects it if the credential is bad, since nothing settled.
    //
    // This runs before `resolvePrice` on purpose. Pricing is a separate backend
    // and it can be down; resolving first would make callers who never pay
    // depend on its availability to reach a route they already have access to.
    //
    // A resolved `userId` counts too: the app-wide `userAuthMiddleware` runs
    // first, and its development bypass authenticates a request that carries no
    // `Authorization` header at all. The header check still matters for a bad
    // token, which leaves `userId` unset and must reach the auth chain's 401.
    const authorization = c.req.header('Authorization');
    const alreadyAuthenticated = Boolean(c.get('userId'));
    if (
      alreadyAuthenticated ||
      (authorization && !Credential.extractPaymentScheme(authorization))
    ) {
      c.set('machinePaymentTier', 'authenticated');
      return next();
    }

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

    // Attach the receipt *before* the handler runs. Hono merges context headers
    // into the handler's response and into the error handler's alike, so a
    // request that settled always carries its proof of payment — even when
    // delivery fails afterwards. Assigning to `c.res` after `next()` would drop
    // the receipt on the throw path, leaving a charged caller unable to prove
    // the charge while the spent credential is refused as a replay on retry.
    const receiptHeader = result.withReceipt(new Response(null)).headers.get(RECEIPT_HEADER);
    if (receiptHeader) c.header(RECEIPT_HEADER, receiptHeader);

    // Amount and currency are the quote this request settled against, in the
    // currency's major unit. They are what was charged: mppx verified the
    // credential against a challenge composed from this very price, and binds
    // the amount into the challenge id, so a credential for any other quote was
    // refused above. The settled challenge is no substitute — a real method
    // (Tempo, Stripe) stores its amount in base units, so it reads `10000` for a
    // charge of `0.01`.
    const settled = settlementOf(c.req.raw);

    // Recorded before delivery for the same reason as the receipt: the money
    // moved whether or not the handler succeeds, so the ledger has to see it
    // either way.
    //
    // But bookkeeping must never cost the caller what they just bought. If the
    // ledger is down, letting it reject here would charge them, withhold the
    // resource, and leave a spent credential that a retry refuses as a replay —
    // so they would have to pay twice. Delivery wins; reconciling a missed row
    // is our problem. Durability belongs to the `recordPayment` implementation,
    // which this middleware calls exactly once and never retries.
    try {
      await recordPayment?.({
        amount: price.amount,
        currency: price.currency,
        reference: receiptHeader ? Receipt.deserialize(receiptHeader).reference : '',
        route,
        ...(settled.claimedSource ? { claimedSource: settled.claimedSource } : {}),
      });
    } catch (error) {
      log(
        'recordPayment failed for a settled request: route=%s receipt=%s %O',
        route,
        receiptHeader,
        error,
      );
    }

    return next();
  };
};

interface SettledCredential {
  claimedSource?: string;
}

/**
 * Who the settled credential claims paid. `source` is caller-supplied and only
 * as trustworthy as the payment method's verification of it, so it is surfaced
 * as a claim.
 *
 * Never throws: the credential already verified, so a parse failure here only
 * means the claim is unknown. Failing a settled request over an unreadable
 * bookkeeping field would charge the caller and then deny them the resource.
 */
const settlementOf = (request: Request): SettledCredential => {
  try {
    const credential = Credential.fromRequest(request);

    return credential.source ? { claimedSource: credential.source } : {};
  } catch {
    return {};
  }
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
