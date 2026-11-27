import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { RequestCredsInputParams, RequestCredsInputState } from './types';

/**
 * Machine-readable failure codes of an approved `requestCredsInput` call. Each
 * failure branch carries one, so a failed save is never a bare message or an
 * empty result the agent has to guess about.
 */
export const RequestCredsInputErrorCode = {
  /** The credential store refused the lookup (HTTP 401/403 or an upstream block reason). */
  AccessDenied: 'CREDS_INPUT_ACCESS_DENIED',
  /** The lookup failed for another reason, so the save cannot be confirmed either way. */
  CheckFailed: 'CREDS_INPUT_CHECK_FAILED',
  /** The lookup answered and no credential has the key: the form was not completed. */
  NotSaved: 'CREDS_INPUT_NOT_SAVED',
} as const;

export type RequestCredsInputErrorCode =
  (typeof RequestCredsInputErrorCode)[keyof typeof RequestCredsInputErrorCode];

export interface RequestCredsInputResultMeta {
  /**
   * Tool call id of this `requestCredsInput` call. The secure form and its
   * approval are keyed on it, so it identifies the request end to end.
   */
  requestId?: string;
}

const requestIdLine = (requestId?: string) => (requestId ? ` Request ID: ${requestId}.` : '');

/**
 * Tool result of an approved `requestCredsInput` call.
 *
 * The secure form writes the values to the credential store before it
 * approves the call, so by the time the tool runs the only thing left to report
 * is whether the key now exists. Built from the request arguments and that
 * lookup alone, the result cannot carry a secret.
 */
export const buildRequestCredsInputResult = (
  args: Pick<RequestCredsInputParams, 'key' | 'name'>,
  found: boolean,
  { requestId }: RequestCredsInputResultMeta = {},
): BuiltinServerRuntimeOutput => {
  if (!found) {
    const state: RequestCredsInputState = { key: args.key, requestId, status: 'not_saved' };

    return {
      content: `No credential with key "${args.key}" was found, so the user did not complete the secure form. Do not ask for the secret in the chat. Call requestCredsInput again only if the user asks to.${requestIdLine(requestId)}`,
      error: {
        code: RequestCredsInputErrorCode.NotSaved,
        message: `Credential not found: ${args.key}`,
        type: 'CredentialNotFound',
      },
      state,
      success: false,
    };
  }

  const state: RequestCredsInputState = { key: args.key, requestId, status: 'saved' };

  return {
    content: `Credential "${args.name || args.key}" is saved under key "${args.key}". The user entered its values in a secure form; they are encrypted and not visible to you. Refer to the credential by its key.${requestIdLine(requestId)}`,
    state,
    success: true,
  };
};

interface UpstreamRefusal {
  reason?: string;
  status?: number;
}

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const pickStatus = (...values: unknown[]) =>
  values.find((value): value is number => typeof value === 'number' && value >= 400);

const pickReason = (...values: unknown[]) =>
  values.find((value): value is string => typeof value === 'string' && value.length > 0);

/**
 * HTTP status and block reason of a refused lookup, read from the error shapes
 * LobeHub services throw: tRPC / Market errors (`status`, `statusCode`,
 * `data.httpStatus`) and gateway refusals (`errorType: 403` with
 * `_responseBody.reason`, e.g. `not_onboarded`).
 */
const getUpstreamRefusal = (error: unknown): UpstreamRefusal => {
  const raw = toRecord(error);
  if (!raw) return {};

  const body = toRecord(raw._responseBody) ?? toRecord(raw.body);
  const data = toRecord(raw.data);

  return {
    reason: pickReason(body?.reason, raw.reason),
    status: pickStatus(raw.status, raw.statusCode, raw.errorType, data?.httpStatus),
  };
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  const message = toRecord(error)?.message;
  return typeof message === 'string' && message ? message : 'Unknown error';
};

/**
 * Tool result when the credential lookup itself failed. The form may or may
 * not have saved the values, so the result says the save is unconfirmed, and
 * names the code, HTTP status and upstream reason it has — a refusal must stay
 * diagnosable instead of collapsing into a bare "Request blocked".
 */
export const buildRequestCredsInputCheckFailure = (
  args: Pick<RequestCredsInputParams, 'key'>,
  error: unknown,
  { requestId }: RequestCredsInputResultMeta = {},
): BuiltinServerRuntimeOutput => {
  const message = getErrorMessage(error);
  const { reason, status } = getUpstreamRefusal(error);
  const denied = !!reason || status === 401 || status === 403;
  const code = denied
    ? RequestCredsInputErrorCode.AccessDenied
    : RequestCredsInputErrorCode.CheckFailed;
  const state: RequestCredsInputState = { key: args.key, requestId, status: 'unconfirmed' };

  const details = [
    `code: ${code}`,
    status ? `HTTP ${status}` : undefined,
    reason ? `reason: ${reason}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');

  const content = denied
    ? `Could not confirm credential "${args.key}": the credential store refused the lookup (${details}; upstream message: ${message}). This is an account- or permission-level refusal, so retrying will fail the same way. Tell the user the credential could not be confirmed and quote the code and reason. Do not ask for the secret in the chat.${requestIdLine(requestId)}`
    : `Could not confirm credential "${args.key}": the credential lookup failed (${details}; message: ${message}). The secure form may still have saved it. Do not ask for the secret in the chat; tell the user the save could not be confirmed.${requestIdLine(requestId)}`;

  const diagnostics = {
    code,
    ...(reason && { reason }),
    ...(status && { httpStatus: status }),
  };

  return {
    content,
    error: {
      ...diagnostics,
      // Client persistence keeps only `body`/`message`/`type` of a tool error,
      // so the diagnostics ride in `body` too to survive into rebuilt history.
      body: diagnostics,
      message,
      type: 'CheckCredentialFailed',
    },
    state,
    success: false,
  };
};
