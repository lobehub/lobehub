# Worked Examples

Two real workflows already in the codebase that follow this skill's pattern verbatim. Skim them when you want to see the pattern applied to concrete entities.

## Example 1: Welcome Placeholder

**Use case:** Generate AI-powered welcome placeholders for users.

**Structure:**

- Layer 1: `process-users` — entry point, checks eligible users
- Layer 2: `paginate-users` — paginates through active users
- Layer 3: `generate-user` — generates placeholders for ONE user

**Key features:**

- Filters users who already have cached placeholders in Redis
- `paidOnly` flag to scope to subscribed users
- `dryRun` mode for statistics
- Fan-out for large user batches (`CHUNK_SIZE=20`)

**Layer 3 shape:**

```typescript
export const { POST } = serve<GenerateUserPlaceholderPayload>(async (context) => {
  const { userId } = context.requestPayload ?? {};

  const workflow = new WelcomePlaceholderWorkflow(db, userId);
  const placeholders = await context.run('generate', () => workflow.generate());

  return { success: true, userId, placeholdersCount: placeholders.length };
});
```

**Files:**

- `/api/workflows/welcome-placeholder/process-users/route.ts`
- `/api/workflows/welcome-placeholder/paginate-users/route.ts`
- `/api/workflows/welcome-placeholder/generate-user/route.ts`
- `/server/workflows/welcomePlaceholder/index.ts`

---

## Example 2: Agent Welcome

**Use case:** Generate welcome messages and open questions for AI agents.

**Structure:**

- Layer 1: `process-agents` — entry point, checks eligible agents
- Layer 2: `paginate-agents` — paginates through active agents
- Layer 3: `generate-agent` — generates welcome data for ONE agent

**Key features:**

- Filters agents who already have cached data in Redis
- `paidOnly` flag for subscribed users' agents only
- `dryRun` mode for statistics
- Fan-out for large agent batches (`CHUNK_SIZE=20`)

**Layer 3 shape:**

```typescript
export const { POST } = serve<GenerateAgentWelcomePayload>(async (context) => {
  const { agentId } = context.requestPayload ?? {};

  const workflow = new AgentWelcomeWorkflow(db, agentId);
  const data = await context.run('generate', () => workflow.generate());

  return { success: true, agentId, data };
});
```

**Files:**

- `/api/workflows/agent-welcome/process-agents/route.ts`
- `/api/workflows/agent-welcome/paginate-agents/route.ts`
- `/api/workflows/agent-welcome/generate-agent/route.ts`
- `/server/workflows/agentWelcome/index.ts`

---

## What's identical, what differs

Both workflows are the **same pattern** — they only differ in:

- Entity type (users vs agents)
- Business logic (placeholder generation vs welcome generation)
- Data source (different database queries)

Everything else — the 3-layer split, dry-run handling, fan-out, filter-existing, flowControl tuning — is identical. That's the whole point: once you internalize the pattern, adding a new workflow is mostly entity-substitution.
