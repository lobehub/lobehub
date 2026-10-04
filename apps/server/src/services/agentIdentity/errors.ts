/**
 * Why an account write was refused, in terms a caller can show to a person.
 *
 * - `identifier_taken`: another live account already routes on this handle, so
 *   mounting it again would make inbound delivery ambiguous.
 */
export type AgentAccountErrorCode = 'identifier_taken';

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
