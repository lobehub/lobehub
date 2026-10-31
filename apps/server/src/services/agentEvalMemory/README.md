# Agent Eval Memory

Isolated native Memory for Agent Eval attempts. Every attempt (one test case in
a run, or one pass\@k thread of it) reads and writes the real Memory tables, but
under its own storage-only owner, so a trial never touches the caller's
memories, attempts never see each other's writes, and every attempt starts
from the case's fixture.

## Files

| Path                                                         | Role                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `apps/server/src/services/agentEvalMemory/index.ts`          | `AgentEvalMemoryService`: `prepare`, `snapshot`, `cleanup`, `cleanupTrial`, `cleanupRun` |
| `apps/server/src/services/agentEvalMemory/scope.ts`          | `resolveEvalMemoryScope`: the only way execution turns a scope reference into an owner   |
| `apps/server/src/services/agentEvalRun/trialMemory.ts`       | Where the eval run service prepares and releases attempt Memory                          |
| `apps/server/src/services/agentEvalRun/evalMemory.schema.ts` | zod validation of `environment.memory` before seeding                                    |
| `packages/database/src/schemas/agentEvalMemory.ts`           | `agent_eval_memory_scopes` table                                                         |
| `packages/database/migrations/0182_eval_memory_scopes.sql`   | Table, indexes, CHECK constraint, and the hand-written delete trigger                    |
| `packages/database/src/utils/evalMemoryUser.ts`              | Literals and predicates that recognise a storage-only owner                              |
| `packages/database/src/utils/evalTopic.ts`                   | `notEvalTopic()`: keeps eval dialogue out of background Memory extraction                |

## Lifecycle of one attempt

```
prepare ──► run the attempt ──► completion: snapshot + delete owner ──► run over: sweep leftovers
```

1. **Prepare** (`trialMemory.prepareTrialMemory`, before `execAgent` on every
   attempt and resume). In one transaction it inserts a `users` row
   `eval-memory:<uuid>` that is banned with `ban_reason =
'eval-memory-storage-only'` (no email, credentials or workspace, so it can
   never sign in), records the mapping in `agent_eval_memory_scopes`, and seeds
   the case fixture (`environment.memory`; `{}` when absent) through the native
   Memory runtime, embeddings included. `seededAt` pins every seeded row to the
   case clock. Preparing the same attempt again returns the existing scope; a
   changed fixture is rejected.
2. **Run.** The scope reference travels as `evalRuntime.memory` →
   `state.plan.eval.memory`. The Memory tool (`serverRuntimes/memory.ts`) and
   persona injection (`operationPrep.ts`) resolve it against the trial's topic
   (and, for a pass\@k thread, that exact thread) and read and write only the
   storage owner. A sub-agent the attempt forks (`callSubAgent`) inherits the
   reference with the rest of the eval context (`ExecVirtualSubAgentParams.eval`)
   and, running in an isolation thread of the same topic, shares a topic-level
   attempt's Memory. An eval run without a scope fails instead of falling back
   to the caller. Eval turns also pass `appContext.suppressSignal`, so Agent
   Signal never sees eval dialogue.
3. **Release on completion.** When an attempt completes (`recordTrajectoryCompletion`,
   `recordThreadCompletion`), its final Memory is captured as an
   `EvalMemorySnapshot` (no vectors), stored on the scope row and in the
   attempt's result (`evalResult.memorySnapshot`, or the thread's metadata),
   and the storage owner is deleted; its Memory rows cascade. An attempt that
   ended in an execution error keeps its Memory so it can resume.
4. **Sweep.** `cleanupRun` releases whatever is left (errored, timed-out or
   aborted attempts) when the run finalizes, times out or is aborted. A released
   attempt cannot resume in place; retrying a case creates a new topic and a new
   scope.

Deleting a run, case, topic or thread deletes its scopes by cascade; the
`eval_memory_scope_delete_owner` trigger then deletes any storage owner that was
still alive.

## Invariants

- A storage owner is identified by all three markers: id prefix `eval-memory:`,
  `banned = true`, `ban_reason = 'eval-memory-storage-only'`. Code that walks
  `users` for people (for example the Memory extractor's user listing) filters
  them out with `notEvalMemoryStorageUser()`.
- One scope per attempt: unique `(run_id, topic_id)` for a topic-level attempt
  and `(run_id, topic_id, thread_id)` for a pass\@k thread.
- Authentication, permissions and billing stay on the caller; only Memory
  storage moves to the owner.
