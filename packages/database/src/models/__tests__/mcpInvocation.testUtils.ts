import { createHash, randomUUID } from 'node:crypto';

import type { McpInvocationIdentity } from '@lobechat/mcp-elicitation/transport';
import type { ChatToolPayload } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  messagePlugins,
  messages,
  topics,
  users,
  workspaces,
} from '../../schemas';
import { AgentInterventionModel } from '../agentIntervention';
import { McpInvocationModel } from '../mcpInvocation';

export const db = await getTestDB();
export const owner = 'mcp-invocation-coverage-owner';
export const other = 'mcp-invocation-coverage-other';
export const workspace = 'mcp-invocation-coverage-workspace';
export const otherWorkspace = 'mcp-invocation-coverage-other-workspace';

export async function resetFixtures() {
  await db.delete(agentOperations).where(inArray(agentOperations.userId, [owner, other]));
  await db.delete(workspaces).where(inArray(workspaces.id, [workspace, otherWorkspace]));
  await db.delete(users).where(inArray(users.id, [owner, other]));
  await db.insert(users).values([{ id: owner }, { id: other }]);
  await db
    .insert(workspaces)
    .values(
      [workspace, otherWorkspace].map((id) => ({ id, slug: id, name: id, primaryOwnerId: owner })),
    );
}
export async function clearFixtures() {
  await db.delete(agentOperations).where(inArray(agentOperations.userId, [owner, other]));
  await db.delete(workspaces).where(inArray(workspaces.id, [workspace, otherWorkspace]));
  await db.delete(users).where(inArray(users.id, [owner, other]));
}

export async function createAnchor(
  options: {
    id?: string;
    userId?: string;
    workspaceId?: string;
    tools?: ChatToolPayload[];
    ownerLeaseUntil?: number;
  } = {},
) {
  const id = options.id ?? randomUUID();
  const userId = options.userId ?? owner;
  const workspaceId = options.workspaceId;
  const topicId = `topic-${id}`;
  const assistantId = `assistant-${id}`;
  const tools = options.tools ?? [
    { id: 'call_1', identifier: 'fixture', apiName: 'form', arguments: '{}', type: 'mcp' },
  ];
  const toolIds = tools.map((_, index) => `tool-${id}-${index}`);
  await db.insert(topics).values({ id: topicId, userId, workspaceId });
  await db.insert(messages).values({
    id: assistantId,
    role: 'assistant',
    content: '',
    tools,
    userId,
    workspaceId,
    topicId,
  });
  for (const [index, tool] of tools.entries()) {
    await db.insert(messages).values({
      id: toolIds[index],
      role: 'tool',
      content: '',
      userId,
      workspaceId,
      topicId,
      parentId: assistantId,
    });
    await db.insert(messagePlugins).values({
      id: toolIds[index],
      userId,
      workspaceId,
      toolCallId: tool.id,
      apiName: tool.apiName,
      identifier: tool.identifier,
      arguments: tool.arguments,
      type: tool.type,
    });
  }
  const step = {
    assistantMessageId: assistantId,
    deadline: Date.now() + 300000,
    leaseUntil: options.ownerLeaseUntil ?? 0,
    owner: 'original-tab',
    toolMessageIds: toolIds.filter((_, index) => tools[index].type === 'mcp'),
  };
  await db.insert(agentOperations).values({
    id,
    userId,
    workspaceId,
    topicId,
    status: 'running',
    model: 'original-model',
    provider: 'original-provider',
    metadata: { clientMcpStep: step },
  });
  const identity: McpInvocationIdentity = {
    userId,
    workspaceId,
    operationId: id,
    assistantMessageId: assistantId,
    toolCallId: tools[0].id,
  };
  return {
    id,
    userId,
    workspaceId,
    topicId,
    assistantId,
    tools,
    toolIds,
    step,
    identity,
    model: new McpInvocationModel(db, userId, workspaceId),
  };
}
export type Anchor = Awaited<ReturnType<typeof createAnchor>>;

export async function createInteraction(
  anchor: Anchor,
  options: {
    deadline?: number;
    legacy?: boolean;
    batchId?: string;
    requests?: string;
    serverName?: string;
  } = {},
) {
  const batchId = options.batchId ?? randomUUID();
  const model = new AgentInterventionModel(db, anchor.userId, anchor.workspaceId);
  const requests = {
    input: {
      mode: 'form',
      message: 'Choose a label',
      requestedSchema: {
        type: 'object',
        properties: { label: { type: 'string' } },
        required: ['label'],
      },
    },
  };
  const [item] = await model.createBatch({
    operationId: anchor.id,
    batchId,
    activityKey: `mcp:${anchor.id}:${batchId}`,
    source: 'mcp',
    stepIndex: 0,
    systemActionEligibility: 'review_only',
    deadline: new Date(options.deadline ?? Date.now() + 300000),
    items: [
      {
        allowedActions: ['submit_custom'],
        interactionKind: 'custom',
        surface: 'form',
        toolCallId: anchor.tools[0].id,
        toolMessageId: anchor.toolIds[0],
        requestRevisionHash: 'a'.repeat(64),
        reviewTokenHash: createHash('sha256').update(batchId).digest('hex'),
        reviewContext: { title: 'Fixture', summary: 'Choose a label' },
        sanitizedRequest: {
          apiName: 'form',
          identifier: 'fixture',
          customDetail: {
            kind: 'mcp_elicitation',
            serverName: options.serverName ?? 'Fixture server',
            requests: options.requests ?? JSON.stringify(requests),
          },
        },
      },
    ],
  });
  await db
    .update(messagePlugins)
    .set({
      intervention: { status: 'pending', batchId, operationId: anchor.id },
      state: {
        mcpElicitation: {
          kind: 'mcp_elicitation',
          batchId,
          legacy: options.legacy ?? false,
          checkpoint: { requestState: 'private-checkpoint' },
          connectionBinding: 'private-binding',
          requests,
        },
      },
    })
    .where(eq(messagePlugins.id, anchor.toolIds[0]));
  return { item, model, anchor };
}
export async function claimInteraction(
  interaction: Awaited<ReturnType<typeof createInteraction>>,
  result: Record<string, unknown> = {
    responses: JSON.stringify({
      input: { action: 'accept', content: { label: 'private-answer' } },
    }),
  },
) {
  const { item, model, anchor } = interaction;
  const resolutionRequestId = randomUUID();
  const claim = await model.claimBatch({
    operationId: anchor.id,
    batchId: item.batchId,
    actorId: anchor.userId,
    resolutionRequestId,
    scope: 'single',
    selectedInterventionIds: [item.id],
    expectedItemCount: 1,
    expectedVersions: { [item.id]: item.version },
    expectedRequestRevisionHashes: { [item.id]: item.requestRevisionHash },
    action: { type: 'submit_custom', expectedRevisionHash: item.requestRevisionHash, result },
  });
  if (claim.outcome !== 'applied')
    throw new Error(`Fixture resolution was not claimed: ${claim.outcome}`);
  return { resolutionRequestId, claim };
}
