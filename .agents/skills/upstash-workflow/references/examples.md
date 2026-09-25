# Worked Examples

Two real workflows already in the codebase that follow this skill's pattern. Skim them when you want to see the pattern applied to concrete entities.

## Example 1: Topic Auto Summary

**Use case:** Summarize idle conversation topics.

**Structure:**

- `dispatch` — combined Layer 1 + 2: validates the request, supports `dryRun`, paginates candidate topics with a cursor, and re-triggers itself for the next page
- `execute` — Layer 3: summarizes ONE topic

**Key features:**

- `dryRun` mode walks the same cursor loop without scheduling anything, returning a candidate count
- Cursor-based pagination (`DEFAULT_PAGE_SIZE = 100`) instead of a separate fan-out chunk step — each page is small enough to trigger directly with `Promise.all`
- `flowControl` keyed per user on the execute layer (`topic-auto-summary.execute.user.${userId}`) so one user's backlog can't starve others

**Dispatch shape** (`apps/server/src/router-hono/workflows/topic-auto-summary/dispatch.ts`):

```typescript
export const dispatchTopicAutoSummary = async (
  context: WorkflowContext<DispatchTopicAutoSummaryPayload>,
) => {
  const payload = context.requestPayload ?? {};
  // ...bounds-check idleMinutes/lookbackHours/maxTopics/pageSize, short-circuit on dryRun...

  const candidates = await listCandidates(payload.cursor, Math.min(pageSize, remaining));

  await Promise.all(
    candidates.map((candidate) =>
      runStep(context, `topic-auto-summary:schedule:${candidate.id}`, () =>
        TopicAutoSummaryWorkflow.triggerExecute({
          force: payload.force,
          topicId: candidate.id,
          userId: candidate.userId,
          workspaceId: candidate.workspaceId ?? undefined,
        }),
      ),
    ),
  );

  // ...if there's a next page, `runStep` → `TopicAutoSummaryWorkflow.triggerDispatch(...)` with the new cursor...
  return { hasNextPage, processed: nextProcessed, scheduled: candidates.length };
};
```

**Execute shape** (`apps/server/src/router-hono/workflows/topic-auto-summary/execute.ts`):

```typescript
export const executeTopicAutoSummary = async (
  context: WorkflowContext<ExecuteTopicAutoSummaryPayload>,
) => {
  const { force, topicId, userId, workspaceId } = context.requestPayload ?? {};
  if (!topicId || !userId) return { error: 'Missing topicId or userId', summarized: false };

  return runStep(context, 'topic-auto-summary:generate-and-save', async () => {
    const db = await getServerDB();
    return new TopicAutoSummaryService(db, userId, workspaceId).summarize(topicId, { force });
  });
};
```

**Files:**

- `apps/server/src/router-hono/workflows/topic-auto-summary/index.ts` — Hono app, mounts `/dispatch` and `/execute` with `serve(...)`
- `apps/server/src/router-hono/workflows/topic-auto-summary/dispatch.ts`
- `apps/server/src/router-hono/workflows/topic-auto-summary/execute.ts`
- `apps/server/src/workflows/topicAutoSummary/index.ts` — `TopicAutoSummaryWorkflow` class (`triggerDispatch`, `triggerExecute`)

---

## Example 2: Agent Eval Run

**Use case:** Run an evaluation benchmark's test cases against an agent.

**Structure:**

- `run-benchmark` — Layer 1: entry point, checks run status, supports `dryRun`
- `paginate-test-cases` — Layer 2: cursor pagination + fan-out
- `execute-test-case` — Layer 3: runs ONE test case (which itself triggers further per-attempt trajectory workflows — out of scope for this pattern)

**Key features:**

- Filters test cases that already have results before scheduling work
- `dryRun` mode for statistics only
- Fan-out for large batches: `PAGE_SIZE = 50`, `CHUNK_SIZE = 20`

**Layer 2 fan-out** (`apps/server/src/router-hono/workflows/agent-eval-run/workflows/paginateTestCases.ts`):

```typescript
const CHUNK_SIZE = 20; // Max items to process directly
const PAGE_SIZE = 50; // Items per page

export const paginateTestCasesHandler = async (
  context: WorkflowContext<PaginateTestCasesPayload>,
) => {
  // ...resolve run, paginate test cases, filter ones that need execution...

  if (testCaseIds.length > CHUNK_SIZE) {
    const chunks = chunk(testCaseIds, CHUNK_SIZE);
    await Promise.all(
      chunks.map((ids, idx) =>
        runStep(context, `agent-eval-run:fanout:${idx + 1}/${chunks.length}`, () =>
          AgentEvalRunWorkflow.triggerPaginateTestCases({ runId, testCaseIds: ids, userId }),
        ),
      ),
    );
  } else {
    await Promise.all(
      testCaseIds.map((testCaseId) =>
        runStep(context, `agent-eval-run:execute:${testCaseId}`, () =>
          AgentEvalRunWorkflow.triggerExecuteTestCase({ runId, testCaseId, userId }),
        ),
      ),
    );
  }

  // ...if there's a next page, `runStep` → `AgentEvalRunWorkflow.triggerPaginateTestCases(...)` with the new cursor...
};
```

**Layer 3 shape** (`apps/server/src/router-hono/workflows/agent-eval-run/workflows/executeTestCase.ts`):

```typescript
export const executeTestCaseHandler = async (context: WorkflowContext<ExecuteTestCasePayload>) => {
  const { runId, testCaseId, userId } = context.requestPayload ?? {};
  // ...load the run, bail out if aborted...

  await runStep(context, `agent-eval-run:trajectory:${runId}:${testCaseId}`, () =>
    AgentEvalRunWorkflow.triggerRunAgentTrajectory({ runId, testCaseId, userId }),
  );

  return { k, success: true, testCaseId };
};
```

**Files:**

- `apps/server/src/router-hono/workflows/agent-eval-run/index.ts` — Hono app, mounts one route per layer with `serve(...)`
- `apps/server/src/router-hono/workflows/agent-eval-run/workflows/runBenchmark.ts`
- `apps/server/src/router-hono/workflows/agent-eval-run/workflows/paginateTestCases.ts`
- `apps/server/src/router-hono/workflows/agent-eval-run/workflows/executeTestCase.ts`
- `apps/server/src/workflows/agentEvalRun/index.ts` — `AgentEvalRunWorkflow` class (`triggerRunBenchmark`, `triggerPaginateTestCases`, `triggerExecuteTestCase`, …)

---

## What's identical, what differs

Both workflows share the same core ideas — dry-run, cursor pagination, `flowControl` tuning, a workflow class with static `trigger*()` methods — but apply them differently:

- Agent Eval Run keeps the classic 3-layer split with an explicit fan-out chunk step (`CHUNK_SIZE`) once a page has more items than it wants to trigger directly.
- Topic Auto Summary collapses Layers 1+2 into a single `dispatch` handler and triggers every candidate in a page directly, relying on a smaller page size instead of a separate chunking step.

Pick whichever shape fits the entity: a chunked fan-out when pages can be large and bursty, a single dispatch loop when a page is already small enough to trigger directly.
