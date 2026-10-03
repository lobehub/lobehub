/**
 * Why an account write was refused, in terms a caller can show to a person.
 *
 * - `capacity_exhausted`: the provider hands out a finite operator inventory
 *   (Linq numbers) and every unit is already bound to a live account.
 * - `identifier_taken`: another live account already routes on this handle, so
 *   mounting it again would make inbound delivery ambiguous.
 */
export type AgentAccountErrorCode = 'capacity_exhausted' | 'identifier_taken';

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
