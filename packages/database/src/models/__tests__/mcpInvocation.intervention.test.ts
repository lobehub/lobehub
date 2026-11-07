// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { agentInterventions, agentOperations } from '../../schemas';
import { AgentInterventionModel } from '../agentIntervention';
import {
  claimInteraction,
  clearFixtures,
  createAnchor,
  createInteraction,
  db,
  other,
  resetFixtures,
  workspace,
} from './mcpInvocation.testUtils';

beforeEach(resetFixtures);
afterAll(clearFixtures);

describe('MCP intervention input and completion persistence', () => {
  it('completes only the owning published MCP resolution, idempotently, without retiring its still-running parent', async () => {
    const a = await createAnchor({ workspaceId: workspace });
    const interaction = await createInteraction(a);
    const { resolutionRequestId: rid } = await claimInteraction(interaction);
    expect((await interaction.model.completeMcpResolution(rid)).outcome).toBe('conflict');
    expect(
      (await new AgentInterventionModel(db, other, workspace).completeMcpResolution(rid)).outcome,
    ).toBe('not_found');
    expect((await interaction.model.markResolutionPublished(rid)).outcome).toBe('applied');
    const complete = await interaction.model.completeMcpResolution(rid);
    expect(complete).toMatchObject({
      outcome: 'applied',
      resolution: { status: 'acknowledged' },
      interventions: [{ id: interaction.item.id, status: 'resolved' }],
    });
    expect((await interaction.model.completeMcpResolution(rid)).outcome).toBe('idempotent');
    expect(
      (await db.select().from(agentOperations).where(eq(agentOperations.id, a.id)))[0].status,
    ).toBe('running');
    expect(await a.model.listPending(a.topicId)).toEqual([]);
  });
  it.each([{ serverName: 'x'.repeat(501) }, { requests: 'x'.repeat(100001) }])(
    'rejects unbounded public MCP schema/source detail without persisting a partial interaction',
    async (detail) => {
      const a = await createAnchor();
      await expect(createInteraction(a, detail)).rejects.toThrow();
      expect(
        await db.select().from(agentInterventions).where(eq(agentInterventions.operationId, a.id)),
      ).toEqual([]);
    },
  );
  it.each([
    {},
    { responses: false },
    { responses: '{}', checkpoint: 'should-not-enter-public-answer' },
    { responses: 'x'.repeat(10001) },
  ])('rejects invalid MCP response envelopes before saving an outbox claim', async (result) => {
    const a = await createAnchor();
    const interaction = await createInteraction(a);
    await expect(claimInteraction(interaction, result)).rejects.toThrow();
    expect(await interaction.model.findBatch(a.id, interaction.item.batchId)).toMatchObject({
      interventions: [{ status: 'pending', resolutionId: null }],
      resolutions: [],
    });
  });
});
