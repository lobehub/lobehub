// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentOperations, messagePlugins, messages } from '../../schemas';
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
const mcp = {
  id: 'call_1',
  apiName: 'form',
  identifier: 'fixture',
  arguments: '{}',
  type: 'mcp' as const,
};
const builtin = { ...mcp, id: 'call_builtin', identifier: 'lobe-agent', type: 'builtin' as const };

describe('client step ownership and lifecycle', () => {
  it('marks only an owned running client anchor as waiting, and persists explicit stop once for its current owner', async () => {
    const a = await createAnchor({ workspaceId: workspace });
    await new McpInvocationModel(db, other, workspace).markClientWaiting(a.id);
    expect(
      (await db.select().from(agentOperations).where(eq(agentOperations.id, a.id)))[0].status,
    ).toBe('running');
    await a.model.markClientWaiting(a.id);
    expect(
      (await db.select().from(agentOperations).where(eq(agentOperations.id, a.id)))[0].status,
    ).toBe('waiting_for_client');
    expect(await a.model.cancelClientStep(a.id, 'stale-tab')).toBe(false);
    expect(
      await new McpInvocationModel(db, other, workspace).cancelClientStep(a.id, a.step.owner),
    ).toBe(false);
    expect(
      await new McpInvocationModel(db, owner, otherWorkspace).cancelClientStep(a.id, a.step.owner),
    ).toBe(false);
    expect(await a.model.cancelClientStep(a.id, a.step.owner)).toBe(true);
    expect(await a.model.cancelClientStep(a.id, a.step.owner)).toBe(false);
    expect(await a.model.leaseClientStep(a.id, 'new-tab')).toBeUndefined();
    expect(
      (await db.select().from(agentOperations).where(eq(agentOperations.id, a.id)))[0],
    ).toMatchObject({
      status: 'interrupted',
      completionReason: 'interrupted',
      completedAt: expect.any(Date),
    });
  });
  it('does not move an ordinary operation or a completed anchor back to waiting', async () => {
    const a = await createAnchor();
    await db.update(agentOperations).set({ metadata: {} }).where(eq(agentOperations.id, a.id));
    await a.model.markClientWaiting(a.id);
    expect(
      (await db.select().from(agentOperations).where(eq(agentOperations.id, a.id)))[0].status,
    ).toBe('running');
    await db
      .update(agentOperations)
      .set({ status: 'done', metadata: { clientMcpStep: a.step } })
      .where(eq(agentOperations.id, a.id));
    await a.model.markClientWaiting(a.id);
    expect(
      (await db.select().from(agentOperations).where(eq(agentOperations.id, a.id)))[0].status,
    ).toBe('done');
  });
  it('returns only this owner/workspace/topic/thread active steps with original provider/model', async () => {
    const a = await createAnchor({ workspaceId: workspace });
    expect(await a.model.clientSteps(a.topicId)).toMatchObject([
      {
        operationId: a.id,
        model: 'original-model',
        provider: 'original-provider',
        workspaceId: workspace,
        step: { assistantMessageId: a.assistantId },
      },
    ]);
    expect(await new McpInvocationModel(db, other, workspace).clientSteps(a.topicId)).toEqual([]);
    expect(await new McpInvocationModel(db, owner, otherWorkspace).clientSteps(a.topicId)).toEqual(
      [],
    );
    expect(await new McpInvocationModel(db, owner).clientSteps(a.topicId)).toEqual([]);
    expect(await a.model.clientSteps('another-topic')).toEqual([]);
    expect(await a.model.clientSteps(a.topicId, 'another-thread')).toEqual([]);
    await db.update(agentOperations).set({ status: 'done' }).where(eq(agentOperations.id, a.id));
    expect(await a.model.clientSteps(a.topicId)).toEqual([]);
  });
  it('allows an active owner heartbeat, but another tab cannot steal or finish that owner', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const a = await createAnchor({ ownerLeaseUntil: now + 300000 });
    expect(await a.model.leaseClientStep(a.id, 'other-tab')).toBeUndefined();
    expect(await a.model.leaseClientStep(a.id, a.step.owner)).toMatchObject({
      operationId: a.id,
      model: 'original-model',
      provider: 'original-provider',
      toolMessageId: a.toolIds[0],
    });
    const op = (await db.select().from(agentOperations).where(eq(agentOperations.id, a.id)))[0];
    expect(op.metadata?.clientMcpStep).toMatchObject({
      owner: a.step.owner,
      leaseUntil: now + 45000,
    });
    expect(await a.model.leaseClientStep(a.id, 'other-tab', true)).toBeUndefined();
    expect(await a.model.leaseClientStep(a.id, a.step.owner, true)).toBeTruthy();
    expect(
      (await db.select().from(agentOperations).where(eq(agentOperations.id, a.id)))[0].status,
    ).toBe('done');
  });
  it('rejects cold finish, foreign user/workspace and malformed/absent anchors without mutating their lease', async () => {
    const a = await createAnchor({ workspaceId: workspace });
    await db
      .update(messages)
      .set({ content: 'original result' })
      .where(eq(messages.id, a.toolIds[0]));
    expect(await a.model.leaseClientStep(a.id, 'cold-tab', true)).toBeUndefined();
    expect(
      await new McpInvocationModel(db, other, workspace).leaseClientStep(a.id, a.step.owner),
    ).toBeUndefined();
    expect(
      await new McpInvocationModel(db, owner, otherWorkspace).leaseClientStep(a.id, a.step.owner),
    ).toBeUndefined();
    expect(await a.model.leaseClientStep('absent', a.step.owner)).toBeUndefined();
    await db
      .update(agentOperations)
      .set({ metadata: { clientMcpStep: { owner: 'broken' } } })
      .where(eq(agentOperations.id, a.id));
    expect(await a.model.leaseClientStep(a.id, 'cold-tab')).toBeUndefined();
    await db.update(agentOperations).set({ metadata: {} }).where(eq(agentOperations.id, a.id));
    expect(await a.model.leaseClientStep(a.id, 'cold-tab')).toBeUndefined();
  });
});

describe('complete original assistant barrier and exactly-once cold parent', () => {
  it('waits for the unmanaged builtin sibling, then grants one cold parent lease across model instances', async () => {
    const a = await createAnchor({ tools: [mcp, builtin] });
    await db
      .update(messages)
      .set({ content: 'MCP original result' })
      .where(eq(messages.id, a.toolIds[0]));
    expect(await a.model.leaseClientStep(a.id, 'cold-tab')).toBeUndefined();
    await db
      .update(messages)
      .set({ content: 'actual long builtin result' })
      .where(eq(messages.id, a.toolIds[1]));
    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        new McpInvocationModel(db, owner).leaseClientStep(a.id, randomUUID()),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await db.select().from(messages).where(eq(messages.id, a.toolIds[1])))[0].content).toBe(
      'actual long builtin result',
    );
  });
  it('accepts durable empty-success and error results, and reuses the existing empty parent placeholder', async () => {
    const a = await createAnchor({ tools: [mcp, { ...mcp, id: 'call_2' }] });
    await db
      .update(messagePlugins)
      .set({ state: { mcpClientComplete: true } })
      .where(eq(messagePlugins.id, a.toolIds[0]));
    await db
      .update(messagePlugins)
      .set({ error: { type: 'MCP_FAILURE', message: 'remote rejected' } })
      .where(eq(messagePlugins.id, a.toolIds[1]));
    await db.insert(messages).values({
      id: 'existing-parent',
      role: 'assistant',
      content: '',
      parentId: a.toolIds[1],
      userId: owner,
      topicId: a.topicId,
    });
    expect(await a.model.leaseClientStep(a.id, 'cold-tab')).toMatchObject({
      operationId: a.id,
      assistantMessageId: 'existing-parent',
      toolMessageId: a.toolIds[1],
    });
  });
  it('serializes two approval-subset anchors on the original assistant instead of resuming its parent twice', async () => {
    const a = await createAnchor({ tools: [mcp, { ...mcp, id: 'approval_2' }] });
    const secondId = 'approval-subset-anchor';
    await db
      .update(agentOperations)
      .set({ metadata: { clientMcpStep: { ...a.step, toolMessageIds: [a.toolIds[0]] } } })
      .where(eq(agentOperations.id, a.id));
    await db.insert(agentOperations).values({
      id: secondId,
      userId: owner,
      topicId: a.topicId,
      status: 'waiting_for_client',
      metadata: { clientMcpStep: { ...a.step, toolMessageIds: [a.toolIds[1]] } },
    });
    await db
      .update(messages)
      .set({ content: 'first approval result' })
      .where(eq(messages.id, a.toolIds[0]));
    expect(await a.model.leaseClientStep(a.id, 'first-tab')).toBeUndefined();
    expect(await a.model.leaseClientStep(secondId, 'second-tab')).toBeUndefined();
    await db
      .update(messages)
      .set({ content: 'second approval result' })
      .where(eq(messages.id, a.toolIds[1]));
    const claims = await Promise.all([
      a.model.leaseClientStep(a.id, 'first-tab'),
      new McpInvocationModel(db, owner).leaseClientStep(secondId, 'second-tab'),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
  it.each(['content', 'tools'] as const)(
    'does not regenerate a parent that already advanced with %s',
    async (kind) => {
      const a = await createAnchor();
      await db
        .update(messages)
        .set({ content: 'original result' })
        .where(eq(messages.id, a.toolIds[0]));
      await db.insert(messages).values({
        id: 'advanced-parent',
        role: 'assistant',
        content: kind === 'content' ? 'already delivered' : '',
        tools: kind === 'tools' ? [{ ...mcp, id: 'next_call' }] : null,
        parentId: a.assistantId,
        userId: owner,
        topicId: a.topicId,
      });
      expect(await a.model.leaseClientStep(a.id, 'cold-tab')).toBeUndefined();
      expect(
        (await db.select().from(agentOperations).where(eq(agentOperations.id, a.id)))[0].status,
      ).toBe('done');
    },
  );
  it('cannot use an assistant outside the anchor owner scope, even if stored metadata points to it', async () => {
    const a = await createAnchor();
    const foreign = await createAnchor({ userId: other });
    await db
      .update(agentOperations)
      .set({ metadata: { clientMcpStep: { ...a.step, assistantMessageId: foreign.assistantId } } })
      .where(eq(agentOperations.id, a.id));
    expect(await a.model.leaseClientStep(a.id, 'cold-tab')).toBeUndefined();
    expect(
      (await db.select().from(agentOperations).where(eq(agentOperations.id, a.id)))[0].status,
    ).toBe('running');
  });
});

describe('scoped public pending input projection', () => {
  it('projects only the original owner prompt, never saved answers, checkpoint or connection secrets', async () => {
    const a = await createAnchor({ workspaceId: workspace });
    const interaction = await createInteraction(a);
    await claimInteraction(interaction);
    const pending = await a.model.listPending(a.topicId);
    expect(pending).toMatchObject([
      {
        id: interaction.item.id,
        batchId: interaction.item.batchId,
        resolving: true,
        identifier: 'fixture',
        apiName: 'form',
        toolCallId: 'call_1',
        assistantMessageId: a.assistantId,
        serverName: 'Fixture server',
        requests: { input: { mode: 'form' } },
      },
    ]);
    expect(JSON.stringify(pending)).not.toMatch(
      /private-answer|private-checkpoint|private-binding|requestState|connectionBinding|arguments/,
    );
    expect(await new McpInvocationModel(db, other, workspace).listPending(a.topicId)).toEqual([]);
    expect(await new McpInvocationModel(db, owner, otherWorkspace).listPending(a.topicId)).toEqual(
      [],
    );
    expect(await new McpInvocationModel(db, owner).listPending(a.topicId)).toEqual([]);
    expect(await a.model.listPending(a.topicId, 'another-thread')).toEqual([]);
  });
  it('returns only the current round and suppresses expired, cleared and ended prompts', async () => {
    const a = await createAnchor();
    await createInteraction(a);
    const current = await createInteraction(a);
    expect((await a.model.listPending(a.topicId)).map((item) => item.id)).toEqual([
      current.item.id,
    ]);
    await db
      .update(messagePlugins)
      .set({ intervention: { status: 'none' } })
      .where(eq(messagePlugins.id, a.toolIds[0]));
    expect(await a.model.listPending(a.topicId)).toEqual([]);
    await createInteraction(a, { deadline: Date.now() - 1000 });
    expect(await a.model.listPending(a.topicId)).toEqual([]);
    await createInteraction(a);
    await db
      .update(agentOperations)
      .set({ status: 'interrupted' })
      .where(eq(agentOperations.id, a.id));
    expect(await a.model.listPending(a.topicId)).toEqual([]);
  });
  it('does not expose an unusable orphan prompt or a historical non-MCP detail', async () => {
    const a = await createAnchor();
    const interaction = await createInteraction(a);
    await db.update(messages).set({ parentId: null }).where(eq(messages.id, a.toolIds[0]));
    expect(await a.model.listPending(a.topicId)).toEqual([]);
    await db.update(messages).set({ parentId: a.assistantId }).where(eq(messages.id, a.toolIds[0]));
    const { agentInterventions } = await import('../../schemas');
    await db
      .update(agentInterventions)
      .set({ sanitizedRequest: { apiName: 'form', identifier: 'fixture' } })
      .where(eq(agentInterventions.id, interaction.item.id));
    expect(await a.model.listPending(a.topicId)).toEqual([]);
  });
});
