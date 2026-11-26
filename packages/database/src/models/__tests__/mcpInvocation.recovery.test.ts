// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { agentInterventions, agentOperations, messagePlugins } from '../../schemas';
import { McpInvocationModel } from '../mcpInvocation';
import {
  claimInteraction,
  clearFixtures,
  createAnchor,
  createInteraction,
  db,
  otherWorkspace,
  resetFixtures,
  workspace,
} from './mcpInvocation.testUtils';

beforeEach(resetFixtures);
afterAll(clearFixtures);

describe('current-round durable MCP recovery', () => {
  it('does not let 32 old due rounds starve the current due interaction, and concurrent workers claim it once', async () => {
    const a = await createAnchor();
    const deadline = Date.now() - 1000;
    for (let i = 0; i < 32; i++) await createInteraction(a, { deadline: deadline - 1000 - i });
    const current = await createInteraction(a, { deadline });
    const now = Date.now();
    const workers = await Promise.all([
      McpInvocationModel.recoveryWork(db, now),
      McpInvocationModel.recoveryWork(db, now),
    ]);
    const claimed = workers.flatMap((work) => work.interactions);
    expect(claimed.map((item) => item.itemId)).toEqual([current.item.id]);
    expect((await McpInvocationModel.recoveryWork(db, now + 14999)).interactions).toEqual([]);
    expect(
      (await McpInvocationModel.recoveryWork(db, now + 15001)).interactions.map(
        (item) => item.itemId,
      ),
    ).toEqual([current.item.id]);
  });
  it('recovers a saved answer only after both the execution and enqueue fences expire', async () => {
    const a = await createAnchor();
    const interaction = await createInteraction(a);
    const { resolutionRequestId: rid } = await claimInteraction(interaction);
    const now = Date.now();
    await interaction.model.claimCustomExecution(
      { resolutionRequestId: rid, inputHash: 'c'.repeat(64), leaseDurationMs: 1000 },
      new Date(now),
    );
    expect((await McpInvocationModel.recoveryWork(db, now + 999)).interactions).toEqual([]);
    const token = await a.model.claimDispatch(a.id, rid, now + 1001);
    expect(token).toBeTruthy();
    await a.model.acknowledgeDispatch(a.id, rid, token!, 'already-enqueued', now + 1001);
    expect((await McpInvocationModel.recoveryWork(db, now + 46000)).interactions).toEqual([]);
    expect(
      (await McpInvocationModel.recoveryWork(db, now + 46002)).interactions.map(
        (item) => item.itemId,
      ),
    ).toEqual([interaction.item.id]);
  });
  it('never treats an answered legacy live protocol call as a replayable outbox', async () => {
    const a = await createAnchor();
    const interaction = await createInteraction(a, { legacy: true });
    await claimInteraction(interaction);
    expect((await McpInvocationModel.recoveryWork(db)).interactions).toEqual([]);
  });
  it('redrives unconfirmed client admission while its budget is valid, but never a wire already entered', async () => {
    const a = await createAnchor();
    const now = Date.now();
    const identity = { ...a.identity, toolMessageId: a.toolIds[0] };
    await a.model.claimClientDispatch(a.id, identity, now);
    expect((await McpInvocationModel.recoveryWork(db, now + 14999)).clients).toEqual([]);
    expect(
      (await McpInvocationModel.recoveryWork(db, now + 15001)).clients.map(
        (row) => row.operationId,
      ),
    ).toEqual([a.id]);
    await a.model.claimClientWire(a.id, a.toolIds[0], now + 300000);
    expect((await McpInvocationModel.recoveryWork(db, now + 30002)).clients).toEqual([]);
    await db
      .update(agentOperations)
      .set({
        metadata: {
          clientMcpStep: { ...a.step, deadline: now - 61000 },
          mcpClientExpiryFinished: true,
        },
      })
      .where(eq(agentOperations.id, a.id));
    expect((await McpInvocationModel.recoveryWork(db, now + 30002)).clients).toEqual([]);
  });
  it('does not recover a mismatched workspace or a replaced/cleared interaction projection', async () => {
    const a = await createAnchor({ workspaceId: workspace });
    const interaction = await createInteraction(a, { deadline: Date.now() - 1000 });
    await db
      .update(messagePlugins)
      .set({ workspaceId: otherWorkspace })
      .where(eq(messagePlugins.id, a.toolIds[0]));
    expect((await McpInvocationModel.recoveryWork(db)).interactions).toEqual([]);
    await db
      .update(messagePlugins)
      .set({ workspaceId: workspace })
      .where(eq(messagePlugins.id, a.toolIds[0]));
    await db
      .update(messagePlugins)
      .set({ intervention: { status: 'none' } })
      .where(eq(messagePlugins.id, a.toolIds[0]));
    expect((await McpInvocationModel.recoveryWork(db)).interactions).toEqual([]);
    await db
      .update(messagePlugins)
      .set({
        intervention: { status: 'pending', batchId: interaction.item.batchId, operationId: a.id },
      })
      .where(eq(messagePlugins.id, a.toolIds[0]));
    await db
      .update(agentInterventions)
      .set({ status: 'session_ended' })
      .where(eq(agentInterventions.id, interaction.item.id));
    await db
      .update(agentOperations)
      .set({ status: 'interrupted' })
      .where(eq(agentOperations.id, a.id));
    expect((await McpInvocationModel.recoveryWork(db)).interactions).toEqual([]);
  });
});

it('claims due and answered interactions parked on async tools, but never admits that operation to client-step recovery', async () => {
  const a = await createAnchor();
  const due = await createInteraction(a, { deadline: Date.now() - 1000 });
  await db
    .update(agentOperations)
    .set({ status: 'waiting_for_async_tool' })
    .where(eq(agentOperations.id, a.id));
  const first = await McpInvocationModel.recoveryWork(db);
  expect(first.interactions.map((row) => row.itemId)).toEqual([due.item.id]);
  expect(first.clients).toEqual([]);
  const answered = await createInteraction(a);
  await claimInteraction(answered);
  const second = await McpInvocationModel.recoveryWork(db);
  expect(second.interactions.map((row) => row.itemId)).toEqual([answered.item.id]);
  expect(second.clients).toEqual([]);
});
