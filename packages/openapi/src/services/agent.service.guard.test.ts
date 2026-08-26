// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./agent.service.ts', import.meta.url), 'utf8');

describe('AgentService deletion guard wiring', () => {
  it('keeps both OpenAPI deletion modes inside the durable-state guard transaction', () => {
    expect(source).toContain('assertAgentDeletionAllowed');
    expect(source).toContain('await this.db.transaction(async (tx) =>');
    expect(source).toContain('tx as unknown as LobeChatDatabase');
    expect(source).not.toContain('await this.migrateAgentSessions(request.agentId');
  });
});

describe('AgentService delete share-interrupt guard wiring', () => {
  // LOBE-11930 / codex P1: `DELETE /api/v1/agents/:id` cascades away the
  // agent's share AND its visitor topics in the same transaction as the
  // lambda `removeAgent` path, but used to do so with no interrupt at all.
  // This guards that BOTH delete branches (the `AgentModel.delete` branch
  // and the `migrateSessionTo` raw-delete branch) still snapshot/report
  // in-flight visitor runs instead of regressing back to a silent delete.
  // Behavioral coverage (the actual snapshot query) lives in
  // `packages/database`'s `agent.test.ts`/`topic.query.test.ts` — this only
  // guards the OpenAPI-layer wiring that reaches them.
  it('snapshots and reports active share runs on both delete branches', () => {
    expect(source).toContain('onShareRunsInterrupted');
    expect(source).toContain('findActiveVisitorRunTopics');
    expect(source).toContain("import { TopicModel } from '@/database/models/topic';");
  });
});

describe('AgentService update guard wiring', () => {
  // LOBE-11930: `updateAgent` (backing `PATCH /api/v1/agents/:id`) used to
  // write `agents.model` / `agents.agencyConfig` directly with
  // `tx.update(agents)`, bypassing `AgentModel.updateConfig` — and with it,
  // the row lock + share-reset invariant that keeps a `link` share from
  // surviving a write that turns the agent heterogeneous (Codex / Claude
  // Code). See `writeAgentConfigWithShareReset`'s JSDoc
  // (packages/database/src/utils/agentConfigShareReset.ts) and the real
  // Postgres regression tests there for the behavioral coverage; this test
  // only guards that `updateAgent` keeps calling the shared choke point
  // instead of regressing back to a raw direct write.
  it('routes the agent write through the shared heterogeneous-share-reset helper', () => {
    expect(source).toContain('writeAgentConfigWithShareReset');
    expect(source).toContain(
      "import { writeAgentConfigWithShareReset } from '@/database/utils/agentConfigShareReset';",
    );
  });
});
