// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, agentShares, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';
import { AgentShareModel } from '../agentShare';

// Real-Postgres reproduction of the publish/heterogeneous-reset race described
// in LOBE-11930.
//
// `AgentModel.updateConfig` (packages/database/src/models/agent.ts) resets an
// agent's share to `private` when a config write turns it heterogeneous
// (Claude Code / Codex). `AgentShareModel.updateVisibility` (agentShare.ts)
// publishes a share to `link`, after first rejecting heterogeneous agents.
// Before the fix, `updateConfig`'s row write and share reset were two
// unlocked autocommit statements, and `updateVisibility`'s heterogeneity
// check (formerly `assertShareableAgent` in the router) ran from a pre-lock
// read. That let this interleave land:
//   1. updateVisibility reads the still-homogeneous config → check passes.
//   2. updateConfig runs, turns the agent heterogeneous, resets the share to
//      `private`.
//   3. updateVisibility's own write — already past its check — sets the
//      share back to `link`.
// Result: a live share link on a heterogeneous agent whose every visitor send
// is fail-closed by `AiAgentService`.
//
// This test drives BOTH real models against a REAL node-postgres pool
// (separate connections per call → genuine interleave) with `updateConfig`
// racing `updateVisibility('link')` on the same agent. The fix serializes
// both writers on the same `agents` row lock and re-checks heterogeneity
// under that lock, so the agent must end every trial with its share
// `private` — `link` must never be observable as the final state.

const userId = 'agent-share-publish-race-user';
const serverDB: LobeChatDatabase = await getTestDB();
const agentModel = new AgentModel(serverDB, userId);
const agentShareModel = new AgentShareModel(serverDB, userId);

const cleanup = async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
};

describe('AgentModel.updateConfig × AgentShareModel.updateVisibility — publish race (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: userId }]);
  });

  afterAll(cleanup);

  it('never leaves a heterogeneous agent share published to link', async () => {
    const TRIALS = 20;
    let leaked = 0;
    let rejections = 0;

    for (let i = 0; i < TRIALS; i++) {
      const agentId = `publish-race-${i}`;
      await serverDB
        .insert(agents)
        .values({ id: agentId, model: 'gpt-4o', title: 'Race Agent', userId });
      await agentShareModel.create(agentId, 'link');

      // Writer A: a config write that turns the agent heterogeneous — must
      // reset any existing link share to private (agent.ts:1541-1549).
      // Writer B: a concurrent republish attempt — must be rejected once the
      // agent is heterogeneous, and must never resurrect `link` afterward.
      const results = await Promise.allSettled([
        agentModel.updateConfig(agentId, {
          agencyConfig: { heterogeneousProvider: { type: 'codex' } } as any,
        }),
        agentShareModel.updateVisibility(agentId, 'link'),
      ]);

      if (results[1].status === 'rejected') rejections++;

      const [persisted] = await serverDB
        .select({ visibility: agentShares.visibility })
        .from(agentShares)
        .where(eq(agentShares.agentId, agentId));

      if (persisted.visibility !== 'private') leaked++;
    }

    console.log(
      `[publish race] leaked link share in ${leaked}/${TRIALS} trials; updateVisibility rejected in ${rejections}/${TRIALS} trials`,
    );

    // With both writers serialized on the Agent row and the heterogeneity
    // check re-read under that lock, the share must be `private` at the end
    // of every trial — regardless of which writer won the race to the lock.
    expect(leaked).toBe(0);
  });
});
