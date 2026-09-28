# Goal planning lease rollout and rollback

The pre-lease coordinator does not validate a lease before invoking the planner
or inserting nodes. A rolling deployment with that version is **not supported**.
The guard on legacy running goals prevents takeover of an old worker; it cannot
stop an old worker from reading a goal claimed by a new worker. Five minutes of
elapsed time is not proof that an old process has stopped.

## First deployment

1. Stop admission of Goal advance requests from every entry point (API/client
   fallback, queued kickoff, scheduled and background workers). Pause consumers
   and producers; preserve queued work for replay.
2. Drain all active Goal advance requests and planner calls on the old fleet.
   Terminate remaining old processes if they cannot drain, and confirm they
   cannot reconnect or write. Do not deploy lease-aware workers alongside
   still-running old workers.
3. Deploy the lease-aware version to **all** Goal API and worker instances.
4. Inspect legacy running goals with no task nodes and no planning checkpoint or
   protocol marker. Leave goals with tasks alone. Only after the old fleet has
   stopped, reset confirmed orphan goals to planning using an ownership-scoped
   administrative update; never reset an actively owned goal.
5. Resume admission and replay queued advances. Concurrent lease-aware advances
   are safe. Verify that each goal has one initial task graph.

## Rollback across the lease boundary

Stop admission and drain/terminate **all** lease-aware workers before starting
any pre-lease worker. Do not allow the two protocols to overlap. Reset only
confirmed orphan goals without task nodes to planning after draining. The old
binary does not enforce leases, even if the JSON metadata remains present.

Normal rollouts between versions that both implement this protocol do not need
this stop-and-drain procedure.

## Runtime safeguards

- A running goal with neither checkpoint nor protocol marker is not automatically
  reclaimed: it may belong to an old worker.
- The protocol marker survives lease release, so lease-aware failed attempts can
  retry without reopening the legacy takeover path.
- Ordinary config replacements retain the current row's runtime lease metadata.
  They cannot erase a new claim, overwrite a replacement token, or resurrect a
  released token. Claim/release are the only runtime writers.
- These safeguards do not make old binaries lease-aware. Completing the
  deployment procedure is a release prerequisite, not a claim proven by tests.
