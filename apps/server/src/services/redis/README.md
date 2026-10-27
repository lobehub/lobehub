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
- `linear`: single-use OAuth state for "Connect Linear" (ten minutes, deleted on first read).
- `agentSignal`: spend bounds for background self-iteration — classifier calls per user per UTC
  day, self-feedback declaration slots per topic, manual triggers per user per hour, and the
  distinct topics one nightly review may cover. Its keys live in the `agent-signal` namespace
  next to the Agent Signal runtime stores. Each count returns `undefined` without Redis; the
  Agent Signal caller decides whether that fails open or closed.

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

- `botWake`: channel state for passive bot waking — when the bot and its owner last spoke, the
  follow-up window, the silent-wake count (reset when the bot speaks), classifier calls per bot
  per UTC hour, and the per-channel wake scheduler state (updated under a short lock). Channel
  state is written under both the channel and a Discord thread key. Every read returns
  `undefined` without Redis; the caller waits for nothing and falls back to its existing wake.
