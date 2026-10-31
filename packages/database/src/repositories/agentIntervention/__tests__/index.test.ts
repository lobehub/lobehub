// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  AGENT_INTERVENTION_IDENTITY_CONFLICT,
  AgentInterventionModel,
  hashAgentInterventionRequestRevision,
} from '../../../models/agentIntervention';
import type { AgentInterventionItem } from '../../../schemas';
import {
  agentInterventionResolutions,
  agentInterventions,
  agentOperations,
  messagePlugins,
  messages,
  users,
  userSettings,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentInterventionRepository } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'agent-intervention-repo-owner';
const workspaceId = 'agent-intervention-repo-workspace';
const operationId = 'agent-intervention-repo-operation';
const toolCallId = 'agent-intervention-repo-tool-call';
const toolMessageId = 'agent-intervention-repo-tool-message';
const assistantId = 'agent-intervention-repo-assistant';
const originalArguments = JSON.stringify({ path: 'original.txt' });

const model = new AgentInterventionModel(serverDB, ownerId, workspaceId);
const repository = new AgentInterventionRepository(serverDB, ownerId, workspaceId);

const setOperationStatus = (status: 'done' | 'running' | 'waiting_for_human') =>
  serverDB.update(agentOperations).set({ status }).where(eq(agentOperations.id, operationId));

const readOperationStatus = async () => {
  const [operation] = await serverDB
    .select({ status: agentOperations.status })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId));
  return operation.status;
};

const readToolArguments = async () => {
  const [plugin] = await serverDB
    .select({ arguments: messagePlugins.arguments })
    .from(messagePlugins)
    .where(eq(messagePlugins.id, toolMessageId));
  const [assistant] = await serverDB
    .select({ tools: messages.tools })
    .from(messages)
    .where(eq(messages.id, assistantId));
  return {
    parent: (assistant.tools as { arguments: string }[])[0].arguments,
    plugin: plugin.arguments,
  };
};

const createApprovalBatch = async (): Promise<AgentInterventionItem[]> => {
  await setOperationStatus('waiting_for_human');
  return model.createBatch({
    activityKey: 'repo-activity',
    approvalMode: 'allow-list',
    batchId: 'repo-batch',
    deadline: new Date(Date.now() + 10 * 60_000),
    items: [
      {
        allowedActions: ['approve', 'approve_remember', 'edit_arguments', 'stop'],
        canonicalToolKey: 'filesystem/writeFile',
        interactionKind: 'tool_approval',
        requestRevisionHash: hashAgentInterventionRequestRevision(originalArguments),
        reviewContext: { title: 'Write file' },
        reviewTokenHash: 'c'.repeat(64),
        sanitizedRequest: {
          apiName: 'writeFile',
          argumentCount: 1,
          identifier: 'filesystem',
          parameterNames: ['path'],
        },
        surface: 'binary',
        toolCallId,
        toolMessageId,
      },
    ],
    operationId,
    source: 'runtime',
    stepIndex: 0,
    systemActionEligibility: 'safe_single_binary',
  });
};

const claimApproval = (rows: AgentInterventionItem[]) =>
  repository.claimBatch({
    action: { editedArguments: { path: 'edited.txt' }, type: 'approve' },
    actorId: ownerId,
    batchId: rows[0].batchId,
    expectedItemCount: rows.length,
    expectedRequestRevisionHashes: { [rows[0].id]: rows[0].requestRevisionHash },
    expectedVersions: { [rows[0].id]: rows[0].version },
    operationId,
    resolutionRequestId: randomUUID(),
    scope: 'single',
    selectedInterventionIds: [rows[0].id],
  });

beforeEach(async () => {
  await serverDB.delete(agentInterventions);
  await serverDB.delete(agentInterventionResolutions);
  await serverDB.delete(messagePlugins);
  await serverDB.delete(messages);
  await serverDB.delete(agentOperations);
  await serverDB.delete(userSettings);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values({ id: ownerId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Intervention repository workspace',
    primaryOwnerId: ownerId,
    slug: 'agent-intervention-repo-workspace',
  });
  await serverDB
    .insert(agentOperations)
    .values({ id: operationId, status: 'running', userId: ownerId, workspaceId });
  await serverDB.insert(messages).values([
    {
      content: '',
      id: assistantId,
      role: 'assistant',
      tools: [
        {
          apiName: 'writeFile',
          arguments: originalArguments,
          id: toolCallId,
          identifier: 'filesystem',
          type: 'builtin',
        },
      ],
      userId: ownerId,
      workspaceId,
    },
    {
      content: '',
      id: toolMessageId,
      parentId: assistantId,
      role: 'tool',
      userId: ownerId,
      workspaceId,
    },
  ]);
  await serverDB.insert(messagePlugins).values({
    apiName: 'writeFile',
    arguments: originalArguments,
    id: toolMessageId,
    identifier: 'filesystem',
    toolCallId,
    userId: ownerId,
    workspaceId,
  });
});

describe('AgentInterventionRepository', () => {
  it('applies edited arguments to the tool message on claim and reverts them on rollback', async () => {
    const rows = await createApprovalBatch();

    const claimed = await claimApproval(rows);
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    const edited = JSON.stringify({ path: 'edited.txt' });
    expect(await readToolArguments()).toEqual({ parent: edited, plugin: edited });

    const rolledBack = await repository.rollbackResolution(claimed.resolution.resolutionRequestId);
    expect(rolledBack.outcome).toBe('applied');
    expect(await readToolArguments()).toEqual({
      parent: originalArguments,
      plugin: originalArguments,
    });
  });

  it('retires the parked operation together with the runtime resolution', async () => {
    const rows = await createApprovalBatch();
    const claimed = await claimApproval(rows);
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    await model.markResolutionPublished(claimed.resolution.resolutionRequestId);

    const completed = await repository.completeRuntimeResolution(
      claimed.resolution.resolutionRequestId,
    );

    expect(completed.outcome).toBe('applied');
    expect(completed.resolution?.status).toBe('completed');
    expect(await readOperationStatus()).toBe('done');
  });

  it('commits neither side when the operation can no longer be retired', async () => {
    const rows = await createApprovalBatch();
    const claimed = await claimApproval(rows);
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    await model.markResolutionPublished(claimed.resolution.resolutionRequestId);
    await setOperationStatus('running');

    await expect(
      repository.completeRuntimeResolution(claimed.resolution.resolutionRequestId),
    ).rejects.toThrow(AGENT_INTERVENTION_IDENTITY_CONFLICT);

    const state = await model.findBatch(operationId, rows[0].batchId);
    expect(state.resolutions[0].status).toBe('published');
    expect(state.interventions[0].status).toBe('published');
    expect(await readOperationStatus()).toBe('running');
  });
});
