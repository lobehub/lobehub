/** Identity asserted by a request-attestation protocol (Web Bot Auth / TAP). */
export interface MachinePaymentAttestation {
  /** Protocol that produced the attestation, e.g. `web-bot-auth` or `tap`. */
  protocol: string;
  /** Stable agent identifier asserted by that protocol. */
  subject: string;
}

export interface MachinePaymentPriceParams {
  /** Verified agent attestation, when the caller supplied one. */
  attestation?: MachinePaymentAttestation;
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
  currency: string;
  /**
   * Method-native settlement reference taken from the receipt. Unique per
   * settlement, so it doubles as the idempotency key: the middleware calls
   * `recordPayment` exactly once and never retries, so an implementation that
   * needs durability must dedupe and re-drive on this value.
   */
  reference: string;
  route: string;
  /** Payer identity asserted by the credential (`source`). */
  source?: string;
}
