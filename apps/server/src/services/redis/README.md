# Redis business service

Import `redisService` from `@/server/services/redis`. Domains expose business operations;
callers do not choose a provider, prefix, key, SET options or claim lifetime.

- `deviceSystemInfo.remember`: principal/device scoped answers, three minute default freshness;
  callers may request a freshness bound through the existing gateway API.
- `skillTools.remember`: connection scoped tool lists, ten minutes; empty/failed results are not cached.
- `workspaceRescan.claim`: one background scan per principal/device/directory for 45 seconds.
- `steerQueue`: follow-ups a user queued behind a running agent turn, per topic/thread, held for
  a day. Atomic append (bounded), drain and restore; the runtime drains it into the next turn.
  Writes return `undefined` without Redis, and the caller tells the client to send directly.
- `heteroControl`: control messages for a running heterogeneous agent session (Claude Code), per
  operation, handed out through its `waitHeteroSteer` poll. At most once: a claim pops the message
  and nothing re-queues it; unclaimed past its expiry it reads `expired`, and the run's reported
  result stays readable for an hour. Writes throw without Redis; reads answer `undefined`.
- `linear`: single-use OAuth state for "Connect Linear" (ten minutes, deleted on first read).
- `connectorOAuth`: how each connector OAuth flow ended (account and outcome), for ten minutes,
  read back by the window that started the flow. `null` without Redis.
- `agentDocumentIndex`: the agent-document index snapshot and change notes one conversation
  (topic/thread/agent) renders from, for a day. `undefined` without Redis; the runtime then
  takes a fresh snapshot every run.
- `pageCollab`: a digest of the body each page's last room projection wrote, for a day, so the
  next projection can tell that something wrote the body outside the room. `null` without Redis.
- `agentSignal`: spend bounds for background self-iteration — classifier calls per user per UTC
  day, self-feedback declaration slots per topic, manual triggers per user per hour, and the
  distinct topics one nightly review may cover. Its keys live in the `agent-signal` namespace
  next to the Agent Signal runtime stores. Each count returns `undefined` without Redis; the
  Agent Signal caller decides whether that fails open or closed.
- `taskRunDelivery`: one settle per operation for a Task run's `onComplete` redeliveries — a
  ten minute lease while settling, a three day marker once settled. `unavailable` without Redis;
  the webhook then settles anyway.
- `agentIdentity`: replay claims on agent-account provider webhooks, one per provider event
  id, in the `agent-identity` namespace. `releaseWebhookEvent` gives a claim back when the
  delivery failed after it was claimed. Without Redis the claim falls back to a process-local one.

`client.ts` is the connection seam. `getRedisServiceClient(scope)` takes the `RedisKeys` scope a
domain reads its keys from; `RedisKeyScopeNamespace` maps every scope to the namespace that becomes
the client's key prefix under `REDIS_PREFIX`. A domain therefore names the scope it uses
(`sendPathCache`, `agentSignal`, ...) and can never write a scope's keys under another scope's
prefix. The send-path domains keep `sendPathCache`, preserving deployed cache/claim compatibility;
`agentSignal` maps to `agent-signal`. Each scope has its own cooldown, so one domain's Redis
failures do not switch off another's. Add a separate connection only for a
transport requirement such as pub/sub or blocking commands. Client/provider code and its tests live in `apps/server/src/modules/Redis`.
The service composes this infrastructure through domain methods.
`cache.ts` holds the generic cache/claim policy (read-through caching, the atomic claim with its
process-local fallback) internal to this directory: it is not re-exported, so callers cannot reach
around the domain methods.
The former `src/libs/redis` directory is removed without forwarding exports.
Do not export transport primitives from the business service barrel.

Existing raw-client and client-lib consumers remain explicit migration debt in ESLint.
Move them domain by domain; runtime state requires a deployment/keyspace compatibility plan.
This foundation does not migrate existing runtime, bot or OAuth stores.

- `botDeferred`: how many times each bot message parked behind a busy topic was replayed into a
  run, one key per origin message for 30 minutes. The deferred-message replay drops a message
  past its cap; a replay parked again gets its lap back. Reads return `undefined` without Redis,
  and the replay then proceeds without the cap.

- `botWake`: channel state for passive bot waking — when the bot and its owner last spoke, the
  follow-up window, the silent-wake count (reset when the bot speaks), classifier calls per bot
  per UTC hour, and the per-channel wake scheduler state (updated under a short lock). Channel
  state is written under both the channel and a Discord thread key. Every read returns
  `undefined` without Redis; the caller waits for nothing and falls back to its existing wake.

- `inboundWebhook`: delivery replay claims (24 hours), wake debounce (10 seconds), manual checks
  (30 seconds), maintenance/sweep slots (one minute). Claims fall back to a process-local map;
  durable signal uniqueness remains the event deduplication boundary across instances.
