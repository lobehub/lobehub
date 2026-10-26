# Bot-wake rollout and monitoring

The bot-wake pipeline records every inbound bot message together with the decision made about
it, lets follow-up wakes end in silence (`NO_REPLY`), and hosts the policies, classifier and
scheduler built on top. It ships behind the `bot_wake` feature flag, **off for everyone**.

## What the flag controls

The flag is evaluated for the **bot owner** (the user who owns the provider row), at most once
every 10 seconds per bot.

| Behaviour                                                         | Flag off (default) | Flag on                        |
| ----------------------------------------------------------------- | ------------------ | ------------------------------ |
| `signals` / `signal_decisions` rows for inbound messages          | none written       | one decision per message       |
| Redis wake state (owner presence, follow-up window, budget)       | none written       | written when the bot opts in   |
| A watch-keyword wake                                              | answered, as before | may end in `NO_REPLY` (silence) |
| Reaction / typing / progress message for a watch-keyword wake      | immediate, as before | deferred until the agent speaks |
| Classifier model calls, scheduler parking, enforcing policies      | never              | only if the bot's `botWake` config enables them |
| A scheduled flush of parked messages                              | dropped, not replayed | replayed                    |
| `@mention`, DM, reply and command handling                         | unchanged          | unchanged (never silent)       |

A flag that cannot be read counts as **off**.

### What the flag does not control

- The scenario registry replaced the fixed policy list used by Agent Signal self-iteration. It
  installs the same policies in the same order and still sits behind the Labs "Self-evolving"
  switch, but the code path is new for everyone.
- Migration `0185` and its tables are in the database regardless of the flag.
- `messageMonitoring.enabled` sent to the message gateway follows the bot's `botWake` config,
  not the flag. The server stays authoritative and ignores what the flag keeps off.
- The retention sweep route exists but nothing schedules it (see below).

### What you can validate today

There is no settings field or UI for `botWake` yet, so with the flag on you exercise the
**recording** and the **silent follow-up** only. Policies, the classifier and the scheduler stay
idle until a bot has a `botWake` config.

## Turning it on and off

- Allowlist: publish `bot_wake` as an array of bot-owner user ids through the same runtime-config
  mechanism used for other grayscale flags (for example `agent_share`). `true` turns it on for
  everyone, `false` or absent turns it off.
- Environment: `FEATURE_FLAGS="+bot_wake"` turns it on for everyone (see the self-hosting
  environment variable docs). This needs a restart.
- Kill switch: flip the flag off. It takes effect within the 10 second probe cache plus the flag
  provider's own cache. Rows already written stay; nothing is replayed or answered differently.

## Before widening beyond internal bots

- **Schedule the retention sweep.** The route is
  `POST /api/workflows/agent-signal/prune-signals`; create a QStash schedule (hourly, `0 * * * *`)
  for it. Without it, the message text stored with each decision (up to 4000 characters, including
  chatter nobody addressed to the bot) is kept indefinitely instead of being blanked after 7 days,
  and rows are not trimmed to the newest 10000 per channel.
- Confirm the metrics below reach your backend. A flag flip with no metrics is a blind rollout.

## Metrics

OpenTelemetry instruments in `@lobechat/observability-otel/modules/bot-wake`. Labels are closed
sets only (never user, bot, channel or message ids). The exported names depend on your exporter;
counters already end in `_total`.

| Metric                                  | Labels                                                   | Tells you                                                                    |
| --------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `bot_wake_rollout_checks_total`         | `result` = on / off / error                              | Rollout reach. `error` means the flag store is unreadable (treated as off).  |
| `bot_wake_decisions_total`              | `platform`, `entry_point`, `outcome`, `reason`, `tag`    | Volume and mix of wake/skip/defer decisions.                                 |
| `bot_wake_failures_total`               | `stage` = persist / judge                                | Recording failures. Invisible to users, so alert on any sustained rate.      |
| `bot_wake_record_duration_ms`           |                                                          | Cost of recording one decision (includes shadow policies and the writes).    |
| `bot_wake_policy_verdicts_total`        | `policy_id`, `mode`, `verdict`                           | Shadow policies disagreeing with what the router did.                        |
| `bot_wake_classifier_calls_total`       | `result` = ok / error / timeout / budget                 | Classifier health and spend cap.                                             |
| `bot_wake_classifier_duration_ms`       |                                                          | Classifier latency (timeout is 2 seconds).                                   |
| `bot_wake_no_reply_total`               | `reason`, `result` = labelled / no_decision / error      | Silences by reason. `no_decision` is a silence with no decision to label.    |
| `bot_wake_scheduler_submissions_total`  | `verdict` = hold / release / unavailable                 | Scheduler parking behaviour.                                                 |
| `bot_wake_flushes_total`                | `result` = flushed / flag_off / no_scheduler / no_provider / failed | Delayed flush outcomes. `flag_off` is parked messages dropped.   |
| `bot_wake_retention_rows_total`         | `kind` = pruned / payload_purged                         | Retention sweep activity. Flat at zero means the sweep is not scheduled.     |

Suggested alerts (starting points, tune on real traffic):

- `bot_wake_failures_total` above zero for 10 minutes.
- `bot_wake_rollout_checks_total{result="error"}` above zero.
- `bot_wake_classifier_calls_total` error + timeout above 10% of calls.
- `bot_wake_no_reply_total{result="no_decision"}` above zero.
- `bot_wake_record_duration_ms` p95 above 500 ms.
- `bot_wake_retention_rows_total` flat for 24 hours once the sweep is scheduled.

## Data checks

Run against the database; every query is read-only.

```sql
-- Decisions by outcome and reason, last 24 hours.
SELECT outcome, final_reason, count(*)
FROM signal_decisions
WHERE pipeline_version LIKE 'bot-wake@%' AND created_at > now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY 3 DESC;

-- Shadow policies that would have denied a wake the router allowed.
SELECT d.final_reason, v->>'policyId' AS policy, v->>'reason' AS policy_reason, count(*)
FROM signal_decisions d
CROSS JOIN LATERAL jsonb_array_elements(d.verdicts) v
WHERE d.pipeline_version LIKE 'bot-wake@%'
  AND d.outcome = 'wake'
  AND v->>'mode' = 'shadow'
  AND v->>'verdict' = 'deny'
  AND d.created_at > now() - interval '24 hours'
GROUP BY 1, 2, 3
ORDER BY 4 DESC;

-- Labels by kind and reason, last 7 days.
SELECT l.label, l.metadata->>'reason' AS reason, count(*)
FROM signal_decision_labels l
JOIN signal_decisions d ON d.id = l.decision_id
WHERE d.pipeline_version LIKE 'bot-wake@%' AND l.created_at > now() - interval '7 days'
GROUP BY 1, 2
ORDER BY 3 DESC;

-- Keyword wakes against the share that ended in silence, last 7 days.
SELECT count(*) AS keyword_wakes,
       count(DISTINCT l.decision_id) AS silenced
FROM signal_decisions d
LEFT JOIN signal_decision_labels l
  ON l.decision_id = d.id AND l.source = 'agent:no_reply'
WHERE d.outcome = 'wake' AND d.to_tag = 'keyword' AND d.created_at > now() - interval '7 days';

-- Growth and retention lag of the bot signals.
SELECT count(*) AS signals,
       count(*) FILTER (WHERE payload_purged_at IS NULL) AS holding_payload,
       min(created_at) FILTER (WHERE payload_purged_at IS NULL) AS oldest_unpurged_payload
FROM signals
WHERE source LIKE 'bot:%';
```

## Rollout

1. Merge with the flag off. Expect no new rows and no `bot_wake_decisions_total` series.
2. Allowlist one or two internal bot owners. Expect decisions and verdicts to appear, `failures`
   at zero and `record_duration` low.
3. Watch the data checks for a few days, then widen the allowlist, then set `true`.
4. Roll back by turning the flag off.

## Known gaps

- No settings field or UI for `botWake`, so policies, classifier and scheduler cannot be enabled
  by a user yet.
- The message gateway lives outside this repository. That it forwards ordinary channel messages
  when `messageMonitoring.enabled` is true is its contract, not something verified here.
- Classifier quality has not been measured on real traffic.
- Nothing labels a wake as correct or wrong except the agent's own silence.
