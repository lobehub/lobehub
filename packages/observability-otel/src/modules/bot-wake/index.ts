import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('server-services-bot-wake');

/**
 * Label discipline for every instrument below: only small closed sets (platform, entry point,
 * outcome, reason, policy id, mode, verdict, result). Never a user, bot, application, channel or
 * message id — one series per bot would turn a rollout dashboard into a cardinality incident.
 */

/**
 * Wake decisions recorded for inbound bot messages.
 * Labels: `platform`, `entry_point`, `outcome` (wake|skip|defer), `reason`, `tag`.
 */
export const botWakeDecisionCounter = meter.createCounter('bot_wake_decisions_total', {
  description: 'Bot-wake decisions recorded, by entry point, outcome and reason.',
  unit: '{decision}',
});

/**
 * Failures while recording or judging a wake. Recording never changes bot behaviour, so a failure
 * is invisible to users — this counter is the only way to see one.
 * Labels: `stage` (persist|judge).
 */
export const botWakeFailureCounter = meter.createCounter('bot_wake_failures_total', {
  description: 'Bot-wake recording or judging failures, by stage.',
  unit: '{failure}',
});

/** Time to record one decision, including shadow policies and the database writes. */
export const botWakeRecordDurationHistogram = meter.createHistogram('bot_wake_record_duration_ms', {
  description: 'Duration of recording one bot-wake decision.',
  unit: 'ms',
});

/**
 * Per-policy verdicts inside recorded decisions, shadow ones included — the series that shows a
 * shadow policy disagreeing with what the router actually did.
 * Labels: `policy_id`, `mode` (shadow|enforce), `verdict` (allow|deny|abstain).
 */
export const botWakeVerdictCounter = meter.createCounter('bot_wake_policy_verdicts_total', {
  description: 'Bot-wake policy verdicts, by policy, mode and verdict.',
  unit: '{verdict}',
});

/**
 * Classifier model calls. Labels: `result` (ok|error|timeout|budget). `budget` means the hourly
 * cap refused the call, not that the model failed.
 */
export const botWakeClassifierCounter = meter.createCounter('bot_wake_classifier_calls_total', {
  description: 'Bot-wake classifier calls, by result.',
  unit: '{call}',
});

/** Latency of classifier model calls that reached the model. */
export const botWakeClassifierDurationHistogram = meter.createHistogram(
  'bot_wake_classifier_duration_ms',
  {
    description: 'Latency of bot-wake classifier model calls.',
    unit: 'ms',
  },
);

/**
 * Follow-up wakes that ended in silence. Labels: `reason`, `result` (`labelled` | `no_decision` |
 * `error`). `no_decision` is a silence that found no recorded wake to label.
 */
export const botWakeNoReplyCounter = meter.createCounter('bot_wake_no_reply_total', {
  description: 'Bot-wake follow-ups that ended in silence, by reason and labelling result.',
  unit: '{silence}',
});

/** Scheduler submissions. Labels: `verdict` (`hold` | `release` | `unavailable`). */
export const botWakeSchedulerCounter = meter.createCounter('bot_wake_scheduler_submissions_total', {
  description: 'Bot-wake scheduler submissions, by verdict.',
  unit: '{submission}',
});

/**
 * Scheduled flushes. Labels: `result` (`flushed` | `flag_off` | `no_scheduler` | `no_provider` |
 * `failed`). `flag_off` is parked messages dropped because the rollout was switched off.
 */
export const botWakeFlushCounter = meter.createCounter('bot_wake_flushes_total', {
  description: 'Bot-wake scheduled flushes, by result.',
  unit: '{flush}',
});

/** Rows touched by the signals retention sweep. Labels: `kind` (pruned|payload_purged). */
export const botWakeRetentionCounter = meter.createCounter('bot_wake_retention_rows_total', {
  description: 'Signal rows pruned or payload-purged by the retention sweep.',
  unit: '{row}',
});
