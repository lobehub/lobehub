/**
 * Why an account write was refused, in terms a caller can show to a person.
 *
 * Conflicts — the request was valid, the deployment's state refuses it:
 * - `identifier_taken`: another live account already routes on this handle, so
 *   mounting it again would make inbound delivery ambiguous.
 *
 * Invalid requests — no state would make them succeed:
 * - `capabilities_required`: a mounted account's provider is not registered,
 *   so only the caller can state what the account can do.
 * - `provider_managed`: the provider is registered, so its accounts are opened
 *   through `provision`, never mounted from caller-supplied handles.
 * - `provider_owned_field`: the patch names a field the provider owns.
 * - `invalid_settings`: the patch's settings are not a shape this build accepts.
 * - `reply_target_not_owned`: the message named as a reply target lives in
 *   another account's inbox, so answering it would send as that account.
 *
 * Refused sends — `message` is written for a person, and the code reaches the
 * client as `errorData.code` so it can be localized:
 * - `send_disabled`: the address only receives mail.
 * - `account_unavailable`: the address is released or suspended.
 * - `send_limit_daily` / `send_limit_hourly`: a provider quota is used up.
 * - `send_suspended`: the provider suspended this sender.
 * - `send_rejected`: the provider refused the recipient.
 * - `send_failed`: the provider failed; nothing went out.
 * - `recipient_looping`: the recipient would only feed a mail loop.
 * - `recipients_required`: the send names nobody.
 * - `reply_target_gone`: the mail being answered no longer exists.
 * - `account_not_found` / `draft_not_found`: not in the caller's scope.
 * - `draft_sending`: another request is already sending this draft.
 */
export type AgentAccountErrorCode =
  | 'account_not_found'
  | 'account_unavailable'
  | 'capabilities_required'
  | 'draft_not_found'
  | 'draft_sending'
  | 'identifier_taken'
  | 'invalid_settings'
  | 'provider_managed'
  | 'provider_owned_field'
  | 'recipient_looping'
  | 'recipients_required'
  | 'reply_target_gone'
  | 'reply_target_not_owned'
  | 'send_disabled'
  | 'send_failed'
  | 'send_limit_daily'
  | 'send_limit_hourly'
  | 'send_rejected'
  | 'send_suspended';

const INVALID_REQUEST_CODES = new Set<AgentAccountErrorCode>([
  'capabilities_required',
  'invalid_settings',
  'provider_managed',
  'provider_owned_field',
  'recipient_looping',
  'recipients_required',
  'reply_target_not_owned',
  'send_rejected',
]);

/** A refusal the transport layer maps to a 409 or a 400, never to a 500. */
export class AgentAccountError extends Error {
  readonly code: AgentAccountErrorCode;
  /** Carried to the client as `errorData` by the tRPC error formatter. */
  readonly data: { code: AgentAccountErrorCode };
  /** How a transport should answer: a state conflict (409) or a bad request (400). */
  readonly reason: 'conflict' | 'invalid';

  constructor(code: AgentAccountErrorCode, message: string) {
    super(message);
    this.code = code;
    this.data = { code };
    this.name = 'AgentAccountError';
    this.reason = INVALID_REQUEST_CODES.has(code) ? 'invalid' : 'conflict';
  }
}

export const isAgentAccountError = (error: unknown): error is AgentAccountError =>
  error instanceof AgentAccountError;
