import { RequestTrigger } from '@lobechat/types';

/**
 * Triggers of runs started by a producer other than the composer. Any other
 * trigger (chat, onboarding, …, or a legacy row without one) counts as a
 * foreground run: at most one of those should be live on a topic at a time.
 */
export const BACKGROUND_OPERATION_TRIGGERS: ReadonlySet<string> = new Set<string>([
  RequestTrigger.AgentShare,
  RequestTrigger.AgentSignal,
  RequestTrigger.Api,
  RequestTrigger.Bot,
  RequestTrigger.Cli,
  RequestTrigger.Cron,
  RequestTrigger.Eval,
  RequestTrigger.Goal,
  RequestTrigger.Notify,
  RequestTrigger.Openapi,
  RequestTrigger.Scheduled,
  RequestTrigger.Scm,
  RequestTrigger.Task,
  RequestTrigger.Verify,
]);

export const isForegroundOperationTrigger = (trigger: string | null | undefined): boolean =>
  !trigger || !BACKGROUND_OPERATION_TRIGGERS.has(trigger);

/**
 * How a composer send found the topic's previous foreground run still `running`.
 *
 * - `already_stopping`: the client had already interrupted it (Stop / Send now)
 *   and it is finishing its current step — the expected overlap.
 * - `client_missed`: nothing had asked it to stop. The client neither cancelled
 *   nor replaced a run that was still live; the server-side supersede is the
 *   only thing that stopped it.
 * - `unknown`: the interrupt sentinel could not be read, so the overlap was
 *   superseded without classifying it.
 */
export type SupersedeKind = 'already_stopping' | 'client_missed' | 'unknown';

/** One server run the client tracked on this conversation when it sent. */
export interface ClientOperationSnapshotItem {
  isAborting?: boolean;
  operationId: string;
  status: string;
  visibleLoadingDone?: boolean;
}

/**
 * What the client believed about this conversation's runs when it sent.
 * Recorded only when a supersede happens, to tell *why* the client missed a
 * live run: absent from `operations` means it never tracked the run; present
 * as cancelled means its stop never reached the server.
 */
export interface ClientRunSnapshot {
  operations: ClientOperationSnapshotItem[];
  /** The run the client asked to replace, as sent on the request. */
  replacesOperationId?: string;
}

/** Upper bound on snapshot entries accepted from the client. */
export const MAX_CLIENT_OPERATION_SNAPSHOT = 10;

/** Written to `agent_operations.metadata.supersede` of the run that superseded another. */
export interface SupersedeRecord {
  client?: ClientRunSnapshot;
  kind: SupersedeKind;
  supersededAt: string;
  supersededOperationId: string;
}
