import {
  VENT_CATEGORIES,
  VENT_SEVERITIES,
  type VentParams,
  type VentRejectionReason,
  type VentState,
} from './types';

/** At most this many vents per run; a topic-scoped fallback gets a looser cap. */
export const VENT_LIMIT_PER_OPERATION = 1;
export const VENT_LIMIT_PER_TOPIC = 3;

/** Outcome of asking a ledger to admit one vent into its scope. */
export type VentAdmission = 'accepted' | 'duplicate' | 'rate_limited';

export interface VentAdmitParams {
  /** Normalized content of the vent, see {@link getVentFingerprint}. */
  fingerprint: string;
  /** Maximum number of vents the scope may admit. */
  limit: number;
  /** Run (or topic fallback) the vent is counted against. */
  scopeKey: string;
}

/**
 * Remembers which vents a scope already admitted, so a run cannot turn `vent`
 * into a loop. Client runs keep it in memory; the server backs it with Redis
 * because consecutive steps of one run may land on different instances.
 */
export interface VentLedger {
  admit: (params: VentAdmitParams) => Promise<VentAdmission> | VentAdmission;
}

export interface VentScope {
  key: string;
  limit: number;
}

/** Scope a vent counts against: the run when known, else the topic. */
export const getVentScope = (ids: {
  operationId?: string | null;
  topicId?: string | null;
}): VentScope | undefined => {
  if (ids.operationId)
    return { key: `operation:${ids.operationId}`, limit: VENT_LIMIT_PER_OPERATION };
  if (ids.topicId) return { key: `topic:${ids.topicId}`, limit: VENT_LIMIT_PER_TOPIC };
};

const normalizeText = (value: unknown) =>
  typeof value === 'string' ? value.trim().replaceAll(/\s+/g, ' ').toLowerCase() : '';

/** Content identity of a vent: same summary + details means the same report. */
export const getVentFingerprint = (params: Pick<VentParams, 'details' | 'summary'>) =>
  `${normalizeText(params.summary)}\n${normalizeText(params.details)}`;

/** Rejects a vent before it reaches any ledger; `undefined` means well-formed. */
export const validateVentParams = (
  params: Partial<VentParams> | undefined,
): VentRejectionReason | undefined => {
  if (!VENT_CATEGORIES.includes(params?.category as never)) return 'invalid_category';
  if (!VENT_SEVERITIES.includes(params?.severity as never)) return 'invalid_severity';
  if (!normalizeText(params?.summary) && !normalizeText(params?.details)) return 'empty_content';
};

/**
 * In-memory ledger. Admission is synchronous, so parallel tool calls in one
 * step cannot both slip under the cap. Oldest scopes are evicted past
 * `maxScopes` to keep long-lived processes bounded.
 */
export const createMemoryVentLedger = ({ maxScopes = 1000 } = {}): VentLedger => {
  const scopes = new Map<string, Set<string>>();

  return {
    admit: ({ fingerprint, limit, scopeKey }) => {
      const admitted = scopes.get(scopeKey) ?? new Set<string>();

      if (admitted.has(fingerprint)) return 'duplicate';
      if (admitted.size >= limit) return 'rate_limited';

      admitted.add(fingerprint);
      scopes.delete(scopeKey);
      scopes.set(scopeKey, admitted);

      if (scopes.size > maxScopes) scopes.delete(scopes.keys().next().value!);

      return 'accepted';
    },
  };
};

const STOP_VENTING =
  'Do not call vent again in this run. vent does not stop, end, or reset anything — to finish, reply to the user directly; to make progress, call the tool you actually need.';

/**
 * Renders the tool-result text the calling LLM reads after a vent attempt.
 *
 * The persisted state stays structured; this string must make clear that the
 * report changes nothing about the run, and that a rejected vent must not be
 * retried.
 */
export const formatVentResultContent = (state: VentState): string => {
  if (state.recorded) {
    const label = [state.severity, state.category].filter(Boolean).join(' ');
    return [
      `Vent recorded${label ? ` (${label})` : ''}${state.ventId ? `, id ${state.ventId}` : ''}.`,
      'The friction report has been filed for the platform team. It does not end your turn or change anything — continue your task, and do not vent again in this run.',
    ].join(' ');
  }

  switch (state.reason) {
    case 'rate_limited': {
      return `Vent not recorded: this run already filed its vent. ${STOP_VENTING}`;
    }
    case 'duplicate': {
      return `Vent not recorded: the same report was already filed in this run. ${STOP_VENTING}`;
    }
    case 'empty_content': {
      return `Vent not recorded: summary and details are empty. A vent is only for a concrete platform problem you can describe. ${STOP_VENTING}`;
    }
    case 'invalid_category': {
      return `Vent not recorded: unknown category. Valid categories: ${VENT_CATEGORIES.join(', ')}.`;
    }
    case 'invalid_severity': {
      return `Vent not recorded: unknown severity. Valid severities: ${VENT_SEVERITIES.join(', ')}.`;
    }
    case 'missing_context': {
      return 'Vent not recorded: agent or topic context is missing in this run. Continue your task.';
    }
    default: {
      return 'Vent not recorded. Continue your task.';
    }
  }
};
