# Redis business service

Import `redisService` from `@/server/services/redis`. Domains expose business operations;
callers do not choose a provider, prefix, key, SET options or claim lifetime.

- `deviceSystemInfo.remember`: principal/device scoped answers, three minute default freshness;
  callers may request a freshness bound through the existing gateway API.
- `skillTools.remember`: connection scoped tool lists, ten minutes; empty/failed results are not cached.
- `workspaceRescan.claim`: one background scan per principal/device/directory for 45 seconds.

`client.ts` is the connection seam. All current domains share the existing `sendPathCache`
connection and keyspace, preserving deployed cache/claim compatibility. A namespace is a key
partition, not a reason to open another connection. Add a separate connection only for a
transport requirement such as pub/sub or blocking commands. Client primitives remain in
`src/libs/redis`; do not export them from the business service barrel.

Existing raw-client and client-lib consumers remain explicit migration debt in ESLint.
Move them domain by domain; runtime state requires a deployment/keyspace compatibility plan.
This foundation does not migrate existing runtime, bot or OAuth stores.
