/**
 * Signals — facts the outside world produced, as an Oracle delivered them.
 *
 * An Oracle is whatever brings outside information into LobeHub: a mail
 * provider's webhook today, other feeds later. A signal records only that
 * something happened out there; what it means (a mail, an inbox item, a wake)
 * is decided by whoever processes it.
 */

/** Processing lifecycle of one signal. */
export const SIGNAL_STATUSES = ['pending', 'processed', 'ignored', 'failed'] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

/**
 * Whether a signal of one type is worth a row in `signals`.
 *
 * - `always`: every delivery is stored (low volume, authenticated Oracles such as a mail webhook).
 * - `on_decision`: stored only when a decision is recorded against it, so a feed that is mostly
 *   noise (chat messages nobody woke the bot for) does not fill the table.
 * - `never`: never stored. Per-step runtime events belong here: they fire several times per run
 *   and already live in the runtime's own telemetry.
 */
export const SIGNAL_PERSISTENCE_POLICIES = ['always', 'on_decision', 'never'] as const;
export type SignalPersistencePolicy = (typeof SIGNAL_PERSISTENCE_POLICIES)[number];

/**
 * What we know about a delivery, as opposed to what the source said (that is `payload`).
 *
 * `payload` is the event as the source delivered it and the retention sweep blanks it on a short
 * clock; `metadata` is how it reached us and where it was addressed, and survives that sweep, so a
 * row whose content has expired still says what it was. Never message content: anything that
 * should expire with the payload belongs in the payload.
 */
export interface SignalMetadata {
  /** Where the source addressed the event, e.g. `{ platform, applicationId, platformThreadId, messageId }`. */
  address?: Record<string, string>;
  /** The handler or endpoint that saw the event first, e.g. `onSubscribedMessage`. */
  entryPoint?: string;
  /** Source-specific extras that are not worth a typed field yet. */
  extra?: Record<string, unknown>;
}

/** What a pipeline decided to do with one signal. */
export const SIGNAL_DECISION_OUTCOMES = ['wake', 'skip', 'defer'] as const;
export type SignalDecisionOutcome = (typeof SIGNAL_DECISION_OUTCOMES)[number];

/** How a policy took part in a decision. `off` policies never run, so they are never recorded. */
export type SignalDecisionVerdictMode = 'enforce' | 'shadow';

/** One policy's opinion inside a decision, kept whether or not it took effect. */
export interface SignalDecisionVerdict {
  confidence: number;
  latencyMs: number;
  mode: SignalDecisionVerdictMode;
  policyId: string;
  reason: string;
  verdict: 'abstain' | 'allow' | 'deny';
  version: number;
}

/**
 * What a decision needs beyond its indexed columns: the context it was made in, kept so the decision
 * can be replayed and explained later.
 *
 * Anything that is filtered, grouped or joined on belongs in a column, not here. Never put message
 * content here: it lives in `signals.payload`, which the retention sweep blanks on a clock of its
 * own, and a copy here would outlive it.
 */
export interface SignalDecisionMetadata {
  /** Revision of the pipeline's configuration in force when the decision was made. */
  configRevision?: string;
  /** Scenario-specific extras that are not worth a typed field yet. */
  extra?: Record<string, unknown>;
  /** Ids of the other signals folded into this one (debounced siblings of the same sender). */
  mergedSourceIds?: string[];
  /**
   * The state the policies read, as the scenario declared it — enough to run the same policies
   * again and get the same verdicts.
   */
  stateSnapshot?: Record<string, unknown>;
}

/** What a label needs beyond `label`, `source` and `confidence`. No message content, as above. */
export interface SignalDecisionLabelMetadata {
  /** Scenario-specific extras that are not worth a typed field yet. */
  extra?: Record<string, unknown>;
  /** Short rationale from a judge model or a person. */
  rationale?: string;
  /** Machine-readable reason behind the label, e.g. a `BotNoReplyReason`. */
  reason?: string;
  /**
   * The signal that proved the label, when another event did — e.g. the later manual mention
   * that shows a `missed_wake`. A signal's `external_id`, not its row id.
   */
  evidenceExternalId?: string;
  /** Where the label was applied: `reaction`, `button`, `admin`, `job`, … */
  surface?: string;
}

/** Judgement attached to a decision after the fact. Append-only; a later label never edits an earlier one. */
export const SIGNAL_DECISION_LABELS = [
  'false_wake',
  'dup_wake',
  'bad_reply',
  'missed_wake',
  'correct',
] as const;
export type SignalDecisionLabel = (typeof SIGNAL_DECISION_LABELS)[number];

/**
 * How a bot wake reached the agent.
 *
 * - `mention`: the user addressed the bot directly (@mention, DM, command). The bot always answers.
 * - `followup`: the pipeline woke the bot on its own judgement (solo conversation, watch keyword,
 *   a classifier). The agent may decide not to speak.
 */
export const BOT_WAKE_KINDS = ['mention', 'followup'] as const;
export type BotWakeKind = (typeof BOT_WAKE_KINDS)[number];

/**
 * The token an agent ends its turn with to stay silent after a `followup` wake, optionally
 * followed by `:<reason>` — e.g. `NO_REPLY:duplicate`. Anything else is a normal reply.
 */
export const BOT_NO_REPLY_TOKEN = 'NO_REPLY';

/** Why a woken agent chose not to speak. */
export const BOT_NO_REPLY_REASONS = [
  'not_addressed',
  'off_topic',
  'nothing_to_add',
  'duplicate',
  'already_handled',
  'unspecified',
  'empty_completion',
] as const;
export type BotNoReplyReason = (typeof BOT_NO_REPLY_REASONS)[number];

/**
 * The decision label each silence reason is written under. Staying silent means the wake was not
 * worth an answer (`false_wake`), unless the same message had already been answered (`dup_wake`).
 */
export const BOT_NO_REPLY_LABELS: Record<BotNoReplyReason, SignalDecisionLabel> = {
  already_handled: 'dup_wake',
  duplicate: 'dup_wake',
  empty_completion: 'false_wake',
  nothing_to_add: 'false_wake',
  not_addressed: 'false_wake',
  off_topic: 'false_wake',
  unspecified: 'false_wake',
};

/** An agent run that finished by choosing silence. */
export interface BotNoReplyResult {
  reason: BotNoReplyReason;
}
