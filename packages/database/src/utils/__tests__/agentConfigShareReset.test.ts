// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { AgentShareModel } from '../../models/agentShare';
import { agents, agentShares, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { writeAgentConfigWithShareReset } from '../agentConfigShareReset';

// Regression test for LOBE-11930.
//
// `packages/openapi/src/services/agent.service.ts`'s `updateAgent` (backing
// `PATCH /api/v1/agents/:id`) used to write `agents.model` /
// `agents.agencyConfig` directly with `tx.update(agents)`, bypassing
// `AgentModel.updateConfig` — and with it, the invariant that a `link` share
// must be reset to `private` when a config write turns the agent
// heterogeneous (Codex / Claude Code). That let the OpenAPI PATCH flip a
// published homogeneous agent to a heterogeneous model while its share
// stayed `link`: the owner's Share tab silently disappeared, and every
// visitor send kept failing as `ShareHeterogeneousAgentUnsupported`.
//
// The fix routes both `AgentModel.updateConfig` and the OpenAPI
// `AgentService.updateAgent` through this single `writeAgentConfigWithShareReset`
// choke point. This test drives the helper the same way the OpenAPI service
// calls it — a direct column write plus a `resultingConfig` snapshot, not a
// deep-merged `AgentItem` — against a real Postgres database, mirroring
// `agentShare.publish.race.test.ts` and the "publish gate" block in
// `agentShare.test.ts`.
const userId = 'agent-config-share-reset-user';
const agentId = 'agent-config-share-reset-agent';

const serverDB: LobeChatDatabase = await getTestDB();
const agentShareModel = new AgentShareModel(serverDB, userId);

const cleanup = async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
};

describe('writeAgentConfigWithShareReset (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: userId }]);
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Homogeneous Agent', userId });
  });

  afterAll(cleanup);

  it('resets a link share to private when an OpenAPI-style direct write turns the agent heterogeneous', async () => {
    await agentShareModel.create(agentId, 'link');

    // Mirrors `AgentService.updateAgent`: a plain column patch (not a
    // deep-merged `AgentItem`) computed from the request, with the same
    // `resultingConfig` / `touchesHeterogeneityFields` contract.
    await writeAgentConfigWithShareReset(serverDB, {
      agentId,
      resultingConfig: { agencyConfig: null, model: 'codex' },
      touchesHeterogeneityFields: true,
      updateData: { model: 'codex', updatedAt: new Date() },
      where: eq(agents.id, agentId),
    });

    const [persistedAgent] = await serverDB
      .select({ model: agents.model })
      .from(agents)
      .where(eq(agents.id, agentId));
    expect(persistedAgent.model).toBe('codex');

    const [persistedShare] = await serverDB
      .select({ visibility: agentShares.visibility })
      .from(agentShares)
      .where(eq(agentShares.agentId, agentId));
    expect(persistedShare.visibility).toBe('private');
  });

  it('leaves a link share untouched when the write does not touch model/agencyConfig', async () => {
    await agentShareModel.create(agentId, 'link');

    await writeAgentConfigWithShareReset(serverDB, {
      agentId,
      resultingConfig: { agencyConfig: null, model: 'gpt-4o' },
      touchesHeterogeneityFields: false,
      updateData: { title: 'Renamed Agent', updatedAt: new Date() },
      where: eq(agents.id, agentId),
    });

    const [persistedShare] = await serverDB
      .select({ visibility: agentShares.visibility })
      .from(agentShares)
      .where(eq(agentShares.agentId, agentId));
    expect(persistedShare.visibility).toBe('link');
  });

  it('leaves a private share private when the write turns the agent heterogeneous', async () => {
    await agentShareModel.create(agentId, 'private');

    await writeAgentConfigWithShareReset(serverDB, {
      agentId,
      resultingConfig: { agencyConfig: null, model: 'codex' },
      touchesHeterogeneityFields: true,
      updateData: { model: 'codex', updatedAt: new Date() },
      where: eq(agents.id, agentId),
    });

    const [persistedShare] = await serverDB
      .select({ updatedAt: agentShares.updatedAt, visibility: agentShares.visibility })
      .from(agentShares)
      .where(eq(agentShares.agentId, agentId));
    expect(persistedShare.visibility).toBe('private');
  });
});
