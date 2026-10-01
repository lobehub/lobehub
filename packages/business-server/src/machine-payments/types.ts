export interface MachinePaymentPriceParams {
  // No caller identity yet: the middleware verifies no request attestation
  // (Web Bot Auth / TAP), so pricing cannot depend on who is asking. Add an
  // attestation field here only together with the verifier that produces it.
  /**
   * Route scope, e.g. `GET /v1/search`. Bound into the challenge so a
   * credential minted for one route cannot be replayed against another.
   */
  route: string;
}

export interface MachinePaymentPrice {
  /** Amount in the currency's major unit as a decimal string, e.g. `'0.02'`. */
  amount: string;
  currency: string;
  /** Payment destination in the method's native format. */
  recipient?: string;
}

export interface MachinePaymentRecordParams {
  amount: string;
  /**
   * Payer identity as *claimed* by the credential's `source` field.
   *
   * Untrusted: the protocol does not authenticate `source`, so it is only as
   * trustworthy as the configured payment method's verification of it. A method
   * that verifies payment without binding `source` lets a valid payer attribute
   * usage to any identity. Do not treat it as an authenticated caller id.
   */
  claimedSource?: string;
  currency: string;
  /**
   * Method-native settlement reference taken from the receipt. Unique per
   * settlement, so it doubles as the idempotency key: the middleware calls
   * `recordPayment` exactly once and never retries, so an implementation that
   * needs durability must dedupe and re-drive on this value.
   */
  reference: string;
  route: string;
}
