# Agent Eval Memory

Isolated Memory for Agent Eval attempts. Every attempt (one test case in a run,
or one pass\@k thread of it) has its own entries in `agent_eval_memories`: the
case fixture seeded before the Agent runs, plus whatever the Agent writes. The
Memory tool and the persona injection of an attempt read and write only those
entries, so an attempt never touches the caller's own memories and attempts
never see each other. Entries are evidence: nothing is deleted when the attempt
ends; they go with their run.

## Files

| Path                                                                       | Role                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `index.ts`                                                                 | `AgentEvalMemoryService`: `prepare` (seed once), `getPersonaDocument`, `runtime` (the tool), `snapshot` |
| `search.ts`                                                                | `searchEvalMemory`: the account's hybrid Memory search run over an attempt's entries                    |
| `runtime.ts`                                                               | `EvalMemoryRuntimeService`: the Memory tool surface (search, taxonomy, add, update / remove identity)   |
| `entries.ts`                                                               | Fixture → drafts, the text each layer's vector is built from, the tag rule, the snapshot entry          |
| `where.ts`                                                                 | `attemptWhere`: the rows of one attempt                                                                 |
| `embedding.ts`                                                             | The account's embedding model, billed to the caller as Memory usage                                     |
| `packages/database/src/schemas/agentEvalMemory.ts`                         | `agent_eval_memories`                                                                                   |
| `packages/database/migrations/0199_lobe_bench_environments_and_memory.sql` | The table's BM25 index, the account Memory's definition (0093) over the headline columns and `payload`  |
| `apps/server/src/services/agentEvalRun/evalMemory.schema.ts`               | zod validation of `environment.memory` before seeding                                                   |
| `packages/database/src/utils/evalTopic.ts`                                 | `notEvalTopic()`: keeps eval dialogue out of background Memory extraction                               |

## One table, the account's search

An entry is one row: the headline fields every layer shares (`title`,
`summary`, `details`, `memoryCategory`, `memoryType`, `tags`), the layer's own
part as the Memory tool received it (`payload`: `withPreference`,
`withActivity`, …; a persona's narrative and tagline), one vector, and the
attempt it belongs to. The vector is built from the one field of the layer the
account's Memory embeds and searches (a preference's directives, an activity's
narrative, a context's or identity's description); a persona has none.

`searchEvalMemory` is the account's `UserMemoryQueryModel.searchMemory` with the
rows coming from this table instead of `user_memories*`:

- the same per-layer limits and the same overfetch;
- the same two candidate passes per layer: the nearest entries by cosine
  distance on the layer's vector (the averaged query embeddings), and the newest
  entries whose words all match (`paradedb.match` in conjunction mode over the
  headline columns and the layer's `payload` fields, through a BM25 index with
  the tokenizer of 0093), or the filter-only pass when there is no query;
- the same filters: category, status (activities, contexts), type, relationship
  (identities), tags and labels (every requested one must be among the entry's
  tags), time range (an entry's clock is its `capturedAt`; activities also by
  `startsAt` / `endsAt`, identities by `episodicDate`);
- `scoreHybridCandidates` from the product, with the same base signals;
- the same result shape per layer, `meta.layers` and `meta.ranking` included.

Experience memory is retired in the account's search and is never returned here
either. Without pg_search (PGlite in tests; a deployment that chose another FTS
provider) the queried lexical pass is skipped; the semantic and filter-only
passes still run.

## Lifecycle of one attempt

1. **Prepare** (`trialMemory`, before the Agent runs and on resume): validate
   `environment.memory`, embed the fixture, insert the rows with
   `source = 'fixture'`, `capturedAt = seededAt` and the fixture's hash. A
   resumed attempt keeps its rows and must bring the same fixture.
2. **Run.** The reference (`run`, `topic`, optional `thread`) travels with the
   eval context. The Memory tool (`serverRuntimes/memory.ts`) and the persona
   injection (`operationPrep.ts`) resolve it against the attempt's topic and
   thread and read and write only its rows. An eval run without a reference
   fails instead of falling back to the caller.
3. **Completion.** The attempt's Memory is captured as an `EvalMemorySnapshot`
   (no vectors) on its result, so the run page can show the fixture beside what
   the Agent wrote. Rows stay until the run is deleted.

## Invariants

- One attempt, one set of rows: `attemptWhere` is the only way to read them.
- A removed identity stays as evidence (`removedReason`) and is hidden from
  search and taxonomy.
- Authentication, permissions and billing stay on the caller.
