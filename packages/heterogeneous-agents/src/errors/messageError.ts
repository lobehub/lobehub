import type { ChatErrorHeterogeneousContext, ChatMessageError } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import { isLocalHeterogeneousType } from '../config';
import {
  CLI_CREDIT_LIMIT_PATTERNS,
  CLI_SERVER_THROTTLE_PATTERNS,
  CLI_USER_RATE_LIMIT_PATTERNS,
} from './claudeCodeQuota';
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
  // Older local/remote producers may have sent only { message }. Never infer
  // quota exhaustion from a bare 429 or an allowed rolling-window snapshot.
  if (
    !kind &&
    agentType === 'claude-code' &&
    !CLI_SERVER_THROTTLE_PATTERNS.some((pattern) => pattern.test(message)) &&
    CLI_USER_RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    kind = CLI_CREDIT_LIMIT_PATTERNS.some((pattern) => pattern.test(message))
      ? 'credit_limit'
      : 'usage_limit';
  }
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
