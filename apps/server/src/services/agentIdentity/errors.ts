/**
 * Why an account write was refused, in terms a caller can show to a person.
 *
 * - `capacity_exhausted`: the provider hands out a finite operator inventory
 *   (a carrier with no number left in the requested area code) and every unit is already bound to a live account.
 * - `identifier_taken`: another live account already routes on this handle, so
 *   mounting it again would make inbound delivery ambiguous.
 * - `payment_required`: a paid identity (a dedicated number) needs an active
 *   subscription the user does not have.
 * - `send_not_enabled`: the account can receive but may not send yet — a
 *   dedicated number whose 10DLC campaign is not approved.
 * - `spend_limit_reached`: the agent's number hit its monthly USD or daily
 *   volume cap, or the deployment budget refused the charge.
 */
export type AgentAccountErrorCode =
  | 'capacity_exhausted'
  | 'identifier_taken'
  | 'payment_required'
  | 'send_not_enabled'
  | 'spend_limit_reached';

/** A refusal the transport layer maps to a conflict, never to a 500. */
export class AgentAccountError extends Error {
  readonly code: AgentAccountErrorCode;

  constructor(code: AgentAccountErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AgentAccountError';
  }
}

export const isAgentAccountError = (error: unknown): error is AgentAccountError =>
  error instanceof AgentAccountError;
