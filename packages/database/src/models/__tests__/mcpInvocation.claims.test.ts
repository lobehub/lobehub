// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentOperations, messages } from '../../schemas';
import { McpInvocationModel } from '../mcpInvocation';
import {
  claimInteraction,
  clearFixtures,
  createAnchor,
  createInteraction,
  db,
  other,
  otherWorkspace,
  owner,
  resetFixtures,
  workspace,
} from './mcpInvocation.testUtils';

beforeEach(resetFixtures);
afterAll(clearFixtures);
afterEach(() => vi.restoreAllMocks());

describe('durable MCP producer ownership', () => {
  it('has one first producer under concurrent claims and persists identity across model reconstruction', async () => {
    const a = await createAnchor({ workspaceId: workspace });
    const deadline = Date.now() + 300000;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        new McpInvocationModel(db, owner, workspace).claimProducer(
          a.identity,
          `producer-${i}`,
          'private-fingerprint',
          deadline,
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results.indexOf(true);
    const rebuilt = new McpInvocationModel(db, owner, workspace);
    expect(
      await rebuilt.claimProducer(
        a.identity,
        `producer-${winner}`,
        'private-fingerprint',
        deadline,
      ),
    ).toBe(true);
    expect(
      await rebuilt.claimProducer(
        a.identity,
        `producer-${winner}`,
        'changed-credentials',
        deadline,
      ),
    ).toBe(false);
    expect(
      await rebuilt.claimProducer(a.identity, 'another-process', 'private-fingerprint', deadline),
    ).toBe(false);
    expect(
      await new McpInvocationModel(db, other, workspace).claimProducer(
        { ...a.identity, userId: other },
        'intruder',
        'private-fingerprint',
        deadline,
      ),
    ).toBe(false);
  });
  it('keeps repeated provider IDs distinct across assistants and does not drop unrelated metadata', async () => {
    const a = await createAnchor();
    const deadline = Date.now() + 300000;
    await db
      .update(agentOperations)
      .set({ metadata: { clientMcpStep: a.step, retained: 'original-context' } })
      .where(eq(agentOperations.id, a.id));
    await db.insert(messages).values({
      id: 'next-assistant',
      role: 'assistant',
      content: '',
      tools: a.tools,
      parentId: a.toolIds[0],
      userId: owner,
      topicId: a.topicId,
    });
    expect(await a.model.claimProducer(a.identity, 'first', 'fingerprint', deadline)).toBe(true);
    expect(
      await a.model.claimProducer(
        { ...a.identity, assistantMessageId: 'next-assistant' },
        'second',
        'fingerprint',
        deadline,
      ),
    ).toBe(true);
    expect(
      (await db.select().from(agentOperations).where(eq(agentOperations.id, a.id)))[0].metadata
        ?.retained,
    ).toBe('original-context');
  });
  it('rejects expired, missing, terminal and foreign identities without creating ownership', async () => {
    const a = await createAnchor();
    const deadline = Date.now() + 300000;
    expect(await a.model.claimProducer({ ...a.identity, userId: other }, 'p', 'f', deadline)).toBe(
      false,
    );
    expect(
      await a.model.claimProducer({ ...a.identity, workspaceId: workspace }, 'p', 'f', deadline),
    ).toBe(false);
    expect(await a.model.claimProducer(a.identity, 'p', 'f', Date.now() - 1)).toBe(false);
    expect(
      await a.model.claimProducer({ ...a.identity, operationId: 'absent' }, 'p', 'f', deadline),
    ).toBe(false);
    await db
      .update(agentOperations)
      .set({ status: 'interrupted' })
      .where(eq(agentOperations.id, a.id));
    expect(await a.model.claimProducer(a.identity, 'p', 'f', deadline)).toBe(false);
    expect(
      (await db.select().from(agentOperations).where(eq(agentOperations.id, a.id)))[0].metadata,
    ).not.toHaveProperty('mcpProducerClaims');
  });
});

describe('MCP resolution dispatch and ACK fences', () => {
  it('claims once concurrently, ignores foreign/stale ACK, and recovers a lost enqueue/ACK with a new token', async () => {
    const a = await createAnchor({ workspaceId: workspace });
    const interaction = await createInteraction(a);
    const { resolutionRequestId: rid } = await claimInteraction(interaction);
    const now = Date.now();
    const tokens = await Promise.all(
      Array.from({ length: 8 }, () =>
        new McpInvocationModel(db, owner, workspace).claimDispatch(a.id, rid, now),
      ),
    );
    expect(tokens.filter(Boolean)).toHaveLength(1);
    const token = tokens.find(Boolean)!;
    expect(await a.model.acknowledgeDispatch(a.id, rid, 'wrong-token', 'message', now)).toBe(false);
    expect(
      await new McpInvocationModel(db, owner, otherWorkspace).acknowledgeDispatch(
        a.id,
        rid,
        token,
        'message',
        now,
      ),
    ).toBe(false);
    const next = await new McpInvocationModel(db, owner, workspace).claimDispatch(
      a.id,
      rid,
      now + 15001,
    );
    expect(next).toBeTruthy();
    expect(next).not.toBe(token);
    expect(await a.model.acknowledgeDispatch(a.id, rid, token, 'stale-delivery', now + 15001)).toBe(
      false,
    );
    expect(await a.model.acknowledgeDispatch(a.id, rid, next!, 'saved-message', now + 15001)).toBe(
      true,
    );
    expect(await a.model.claimDispatch(a.id, rid, now + 60000)).toBeUndefined();
    expect(await a.model.claimDispatch(a.id, rid, now + 60002)).toBeTruthy();
  });
  it('does not dispatch a live execution; an expired execution can only recover through its resolution fence', async () => {
    const a = await createAnchor();
    const interaction = await createInteraction(a);
    const { resolutionRequestId: rid } = await claimInteraction(interaction);
    const now = Date.now();
    const execution = await interaction.model.claimCustomExecution(
      { resolutionRequestId: rid, inputHash: 'b'.repeat(64), leaseDurationMs: 300000 },
      new Date(now),
    );
    expect(execution.outcome).toBe('applied');
    expect(await a.model.claimDispatch(a.id, rid, now + 120001)).toBeUndefined();
    expect(await a.model.claimDispatch(a.id, rid, now + 300001)).toBeTruthy();
    const saved = await a.model.executionForTool(a.toolIds[0], interaction.item.batchId);
    expect(saved?.state).toBe('executing');
    expect(saved?.leaseExpiresAt?.getTime()).toBe(now + 300000);
    expect(Number(saved?.dispatchUntil)).toBe(now + 315001);
    expect(await a.model.executionForTool(a.toolIds[0], randomUUID())).toBeUndefined();
    expect(await new McpInvocationModel(db, other).execution(interaction.item.id)).toBeUndefined();
    expect(
      await new McpInvocationModel(db, owner, workspace).executionForTool(
        a.toolIds[0],
        interaction.item.batchId,
      ),
    ).toBeUndefined();
    expect(await a.model.execution(randomUUID())).toBeUndefined();
  });
  it('rejects absent/ended operation, unknown resolution and another owner or workspace', async () => {
    const a = await createAnchor({ workspaceId: workspace });
    const interaction = await createInteraction(a);
    const { resolutionRequestId: rid } = await claimInteraction(interaction);
    expect(
      await new McpInvocationModel(db, other, workspace).claimDispatch(a.id, rid),
    ).toBeUndefined();
    expect(
      await new McpInvocationModel(db, owner, otherWorkspace).claimDispatch(a.id, rid),
    ).toBeUndefined();
    expect(await a.model.claimDispatch('absent', rid)).toBeUndefined();
    expect(await a.model.claimDispatch(a.id, randomUUID())).toBeUndefined();
    await db.update(agentOperations).set({ status: 'done' }).where(eq(agentOperations.id, a.id));
    expect(await a.model.claimDispatch(a.id, rid)).toBeUndefined();
  });
});

describe('client dispatch admission and first wire delivery', () => {
  it('admits one enqueue, recovers expired queue ownership, and never repeats a wire even after its lease expires', async () => {
    const a = await createAnchor();
    const identity = { ...a.identity, toolMessageId: a.toolIds[0] };
    const now = Date.now();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        new McpInvocationModel(db, owner).claimClientDispatch(a.id, identity, now),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await a.model.claimClientDispatch(a.id, identity, now + 14999)).toBe(false);
    expect(await a.model.claimClientDispatch(a.id, identity, now + 15001)).toBe(true);
    const wire = await Promise.all(
      Array.from({ length: 8 }, () =>
        new McpInvocationModel(db, owner).claimClientWire(a.id, a.toolIds[0], now + 60000),
      ),
    );
    expect(wire.filter(Boolean)).toHaveLength(1);
    vi.spyOn(Date, 'now').mockReturnValue(now + 120001);
    expect(await a.model.claimClientWire(a.id, a.toolIds[0], now + 120000)).toBe(false);
    expect(await a.model.claimClientDispatch(a.id, identity, now + 120001)).toBe(false);
    const persisted = (
      await db.select().from(agentOperations).where(eq(agentOperations.id, a.id))
    )[0];
    expect(persisted.metadata?.mcpClientWire).toEqual({
      [a.toolIds[0]]: { leaseUntil: now + 60000 },
    });
  });
  it('fences enqueue/wire on foreign scope and stop; ordinary operations never become a client wire', async () => {
    const a = await createAnchor({ workspaceId: workspace });
    const identity = { toolMessageId: a.toolIds[0] };
    for (const model of [
      new McpInvocationModel(db, other, workspace),
      new McpInvocationModel(db, owner, otherWorkspace),
    ]) {
      expect(await model.claimClientDispatch(a.id, identity)).toBe(false);
      expect(await model.claimClientWire(a.id, a.toolIds[0])).toBe(false);
    }
    await expect(a.model.claimClientDispatch(a.id, {})).rejects.toThrow('tool row is required');
    expect(await a.model.claimClientDispatch('absent', identity)).toBe(false);
    expect(await a.model.claimClientWire('absent', a.toolIds[0])).toBe(false);
    await db.update(agentOperations).set({ metadata: {} }).where(eq(agentOperations.id, a.id));
    expect(await a.model.claimClientWire(a.id, a.toolIds[0])).toBe(false);
    await db
      .update(agentOperations)
      .set({ status: 'interrupted', metadata: { clientMcpStep: a.step } })
      .where(eq(agentOperations.id, a.id));
    expect(await a.model.claimClientDispatch(a.id, identity)).toBe(false);
    expect(await a.model.claimClientWire(a.id, a.toolIds[0])).toBe(false);
  });
});
