import { Errors } from 'mppx';

/**
 * Plain `Error`s that official mppx methods throw from `verify` when the
 * *caller's* payment is at fault. mppx maps any non-`PaymentError` to a 500
 * `InternalPaymentError`, so without translation a declined card reads as our
 * outage instead of a payment the caller can retry.
 *
 * A malformed payload needs no entry: mppx core rejects it against the
 * method's schema with a 402 before `verify` runs.
 *
 * Matched on message because upstream gives them no type; `mppx` is pinned to
 * an exact version and the Stripe tests exercise the real method, so a changed
 * message fails CI rather than silently reverting to 500.
 *
 * Deliberately excluded: Stripe `processing`. The charge may still complete, so
 * answering with a fresh 402 challenge would invite the caller to pay twice. It
 * stays a 500 until it can be reported as pending.
 */
const CALLER_REJECTIONS: RegExp[] = [
  // stripe/server/Charge.js — the PaymentIntent ended in a terminal failure.
  /^Stripe PaymentIntent status: (?:requires_payment_method|canceled)$/,
];

/** Whether `error` is a known caller-caused payment failure (see above). */
export const isCallerPaymentRejection = (error: unknown): boolean =>
  error instanceof Error && CALLER_REJECTIONS.some((pattern) => pattern.test(error.message));

interface VerifyingMethod {
  verify: (parameters: any) => Promise<any>;
}

/**
 * Wraps a server payment method so a caller-caused rejection answers 402 with a
 * fresh challenge instead of a 500.
 *
 * Only errors `isRejection` recognises are translated. Everything else — a
 * misconfigured method, an unreachable payment network — keeps propagating as
 * a 500, because telling the caller to pay again when we cannot tell whether
 * the first payment landed risks charging them twice.
 *
 * Apply it where the method is constructed, before `Mppx.create()`:
 *
 * ```ts
 * Mppx.create({ methods: [withPaymentRejections(stripe.charge({ … }))], … })
 * ```
 */
export const withPaymentRejections = <M extends VerifyingMethod>(
  method: M,
  isRejection: (error: unknown) => boolean = isCallerPaymentRejection,
): M => ({
  ...method,
  verify: async (parameters: Parameters<M['verify']>[0]) => {
    try {
      return await method.verify(parameters);
    } catch (error) {
      if (error instanceof Errors.PaymentError || !isRejection(error)) throw error;
      throw new Errors.VerificationFailedError({ reason: (error as Error).message });
    }
  },
});
