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
