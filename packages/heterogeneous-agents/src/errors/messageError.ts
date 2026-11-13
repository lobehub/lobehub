import type { ChatErrorHeterogeneousContext, ChatMessageError } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import { isLocalHeterogeneousType } from '../config';
import { classifyCliQuotaMessage } from './cliQuota';
import { formatHeteroErrorId, HETERO_ERROR_SPECS, type HeteroErrorKind } from './specs';

const GUIDE_KINDS: Record<string, HeteroErrorKind> = {
  auth_required: 'auth_required',
  cli_not_found: 'cli_not_found',
  overloaded: 'server_overloaded',
  rate_limit: 'usage_limit',
  working_directory_not_found: 'working_directory_not_found',
};
const knownKind = (value: unknown): HeteroErrorKind | undefined =>
  typeof value === 'string' && Object.hasOwn(HETERO_ERROR_SPECS, value)
    ? (value as HeteroErrorKind)
    : undefined;

/** Recover classified CLI failures without losing their guide payload or diagnostics. */
export const normalizeHeterogeneousMessageError = (
  error: ChatMessageError,
  agentTypeHint?: string,
): ChatMessageError => {
  const body = isRecord(error.body) ? error.body : {};
  const agentType = typeof body.agentType === 'string' ? body.agentType : agentTypeHint;
  if (!agentType || !isLocalHeterogeneousType(agentType)) return error;
  const details = isRecord(body.details) ? body.details : {};
  let kind = knownKind(details.kind) ?? knownKind(body.code);
  const message = [error.message, body.message, body.error, body.stderr]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  // A CLI that dies on its own quota before any adapter saw a stream reaches
  // here as a bare { message } — Kimi Code exits with `error: failed to run
  // prompt: provider.auth_error: 403 You've reached your weekly (7-day) usage
  // limit…`. Read it back for EVERY local CLI, not just CC: they all bill
  // against their own subscription, and an unclassified quota rejection
  // renders as the generic JSON card with no reset/schedule/transfer action.
  // Never inferred from a bare 429 or a throttle that disclaims the plan
  // limit — `classifyCliQuotaMessage` requires explicit user-quota wording.
  const quota = kind ? undefined : classifyCliQuotaMessage(message);
  if (quota) kind = quota.kind;
  kind ??=
    typeof body.code === 'string' && Object.hasOwn(GUIDE_KINDS, body.code)
      ? GUIDE_KINDS[body.code]
      : undefined;
  if (!kind) return error;
  const spec = HETERO_ERROR_SPECS[kind];
  return {
    ...error,
    attribution: spec.attribution,
    body: {
      ...body,
      agentType,
      code: spec.guideCode ?? body.code ?? kind,
      details: { ...details, kind },
      message: typeof body.message === 'string' ? body.message : error.message,
      ...(spec.guideCode === 'rate_limit' ? { clearEchoedContent: true } : {}),
      // CLIs that only print prose carry no structured `rate_limit_info`;
      // naming the window it rejected lets the guide card say which limit
      // ran out instead of just "quota exhausted".
      ...(quota?.rateLimitType && !isRecord(body.rateLimitInfo)
        ? { rateLimitInfo: { rateLimitType: quota.rateLimitType, status: 'rejected' } }
        : {}),
    },
    category: spec.category,
    countAsFailure: spec.countAsFailure,
    errorRef: formatHeteroErrorId(kind),
    isFallback: spec.isFallback ?? false,
    numericId: spec.numericId,
    retryable: spec.retryable,
    severity: spec.severity,
    type: 'AgentRuntimeError',
  };
};

/** Project only documented, non-sensitive fields into webhook payloads. */
export const readHeterogeneousErrorContext = (
  error: ChatMessageError | undefined,
): ChatErrorHeterogeneousContext | undefined => {
  if (!error) return;
  const normalized = normalizeHeterogeneousMessageError(error);
  const body = isRecord(normalized.body) ? normalized.body : {};
  const details = isRecord(body.details) ? body.details : {};
  const kind = knownKind(details.kind);
  if (!kind || typeof body.agentType !== 'string' || !isLocalHeterogeneousType(body.agentType))
    return;
  const info = isRecord(body.rateLimitInfo) ? body.rateLimitInfo : {};
  const rejectedQuota = kind === 'usage_limit' && info.status === 'rejected';
  return {
    agentType: body.agentType,
    kind,
    ...(rejectedQuota && typeof info.rateLimitType === 'string'
      ? { rateLimitType: info.rateLimitType }
      : {}),
    ...(rejectedQuota &&
    typeof info.resetsAt === 'number' &&
    Number.isFinite(info.resetsAt) &&
    info.resetsAt > 0 &&
    info.resetsAt < 8640000000000
      ? { resetsAt: info.resetsAt }
      : {}),
  };
};
