/**
 * Why an account write was refused, in terms a caller can show to a person.
 *
 * Conflicts — the request was valid, the deployment's state refuses it:
 * - `capacity_exhausted`: the provider hands out a finite operator inventory
 *   (Linq numbers) and every unit is already bound to a live account.
 * - `identifier_taken`: another live account already routes on this handle, so
 *   mounting it again would make inbound delivery ambiguous.
 *
 * Invalid requests — no state would make them succeed:
 * - `capabilities_required`: a mounted account's provider is not registered,
 *   so only the caller can state what the account can do.
 * - `provider_managed`: the provider is registered, so its accounts are opened
 *   through `provision`, never mounted from caller-supplied handles.
 * - `provider_owned_field`: the patch names a field the provider owns.
 */
export type AgentAccountErrorCode =
  | 'capabilities_required'
  | 'capacity_exhausted'
  | 'identifier_taken'
  | 'provider_managed'
  | 'provider_owned_field';

const INVALID_REQUEST_CODES = new Set<AgentAccountErrorCode>([
  'capabilities_required',
  'provider_managed',
  'provider_owned_field',
]);

/** A refusal the transport layer maps to a 409 or a 400, never to a 500. */
export class AgentAccountError extends Error {
  readonly code: AgentAccountErrorCode;
  /** How a transport should answer: a state conflict (409) or a bad request (400). */
  readonly reason: 'conflict' | 'invalid';

  constructor(code: AgentAccountErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AgentAccountError';
    this.reason = INVALID_REQUEST_CODES.has(code) ? 'invalid' : 'conflict';
  }
}

export const isAgentAccountError = (error: unknown): error is AgentAccountError =>
  error instanceof AgentAccountError;
