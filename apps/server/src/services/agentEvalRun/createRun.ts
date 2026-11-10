import { idGenerator } from '@lobechat/database';
import type {
  EvalRunAgentSnapshot,
  EvalRunInputConfig,
  ImportedMessage,
  ToolIntervention,
} from '@lobechat/types';
import { getActivePluginIds } from '@lobechat/types';
import { clampToolIdentifier } from '@lobechat/utils/clampToolIdentifier';
import { eq, inArray, sql } from 'drizzle-orm';

import { agentEvalRunTopics, messagePlugins, messages, topics } from '@/database/schemas';

import { EVAL_HISTORY_TAIL_METADATA_KEY } from './constants';
import type { EvalRunDeps } from './types';

const EVAL_HISTORY_MESSAGE_BATCH_SIZE = 500;

/** Thrown when a caller-supplied run id exists with non-equivalent create params. */
export const RUN_CREATE_ID_CONFLICT = 'Run id already exists with different create parameters';

/** Stable JSON stringify: sorts object keys recursively, drops undefined. */
const stableStringify = (value: unknown): string => {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? '';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
};

export async function createRun(
  deps: EvalRunDeps,
  params: {
    config?: EvalRunInputConfig;
    datasetId: string;
    experimentId?: string;
    /**
     * Caller-supplied run id for idempotent cross-server creation. When a run
     * with this id already exists: equivalent immutable create params → the
     * existing run is returned; otherwise a conflict error is thrown.
     */
    id?: string;
    /**
     * 'internal' (default): pre-create Topics/RunTopics for every test case and
     * leave the run `idle` until `startRun` triggers the QStash workflow.
     * 'external': create no Topics/RunTopics and set the run `pending` so an
     * external worker can claim it; no workflow is triggered.
     */
    mode?: 'external' | 'internal';
    name?: string;
    parentRunId?: string;
    targetAgentId?: string;
  },
) {
  let { datasetId, targetAgentId } = params;
  let inputConfig = params.config;
  const isExternal = params.mode === 'external';

  // Fork: inherit target agent / dataset / config from the parent run.
  // These are immutable on a fork — reject any override attempt.
  if (params.parentRunId) {
    const parent = await deps.runModel.findById(params.parentRunId);
    if (!parent) throw new Error('Parent run not found');

    if (
      (params.targetAgentId && params.targetAgentId !== parent.targetAgentId) ||
      (params.config && Object.keys(params.config).length > 0) ||
      (params.datasetId && params.datasetId !== parent.datasetId)
    ) {
      throw new Error('Cannot override target agent, config, or dataset when forking a run');
    }

    targetAgentId = parent.targetAgentId ?? undefined;
    datasetId = parent.datasetId;
    inputConfig = (parent.config as EvalRunInputConfig | undefined) ?? undefined;
  }

  // External execution is driven case-by-case through `runExecuteCase`, which
  // only supports single-thread (k=1) runs today. Check after fork resolution
  // so inherited configs are covered too.
  if (isExternal && ((inputConfig as { k?: number } | undefined)?.k ?? 1) > 1) {
    throw new Error('External runs only support k=1 (pass@k is not supported yet)');
  }

  // Validate the experiment scope (and bump its recency once the run exists).
  if (params.experimentId) {
    const experiment = await deps.experimentModel.findById(params.experimentId);
    if (!experiment) throw new Error('Experiment not found');
  }

  // Re-snapshot the current agent config (forks capture the *current* state).
  const agentSnapshot = targetAgentId ? await snapshotAgentConfig(deps, targetAgentId) : undefined;

  // Persist the execution mode as an immutable snapshot: a run's mode cannot
  // be inferred from status once the run reaches a terminal state, and the
  // idempotency check below must compare it.
  const executionMode = isExternal ? ('external' as const) : ('internal' as const);
  const config = { ...inputConfig, agentSnapshot, executionMode };

  // Idempotent create: a caller-supplied id that already exists returns the
  // existing run when the immutable create params are equivalent (datasetId /
  // experimentId / parentRunId / targetAgentId / executionMode / input config
  // — the agent snapshot is excluded since it is re-captured server-side on
  // every create).
  const matchesExisting = (existing: {
    config?: unknown;
    datasetId: string;
    experimentId?: string | null;
    parentRunId?: string | null;
    targetAgentId?: string | null;
  }) => {
    const {
      agentSnapshot: _existingSnapshot,
      executionMode: existingMode,
      ...existingConfig
    } = (existing.config ?? {}) as Record<string, unknown>;
    return (
      existing.datasetId === datasetId &&
      (existing.experimentId ?? null) === (params.experimentId ?? null) &&
      (existing.parentRunId ?? null) === (params.parentRunId ?? null) &&
      (existing.targetAgentId ?? null) === (targetAgentId ?? null) &&
      existingMode === executionMode &&
      stableStringify(existingConfig) === stableStringify(inputConfig ?? {})
    );
  };

  if (params.id) {
    const existing = await deps.runModel.findById(params.id);
    if (existing) {
      if (!matchesExisting(existing)) throw new Error(RUN_CREATE_ID_CONFLICT);
      return existing;
    }
  }

  const { mode: _mode, ...restParams } = params;
  let run;
  try {
    run = await deps.runModel.create({
      ...restParams,
      datasetId,
      targetAgentId,
      config,
      // External runs start claimable; internal runs wait for `startRun`.
      status: isExternal ? 'pending' : 'idle',
    });
  } catch (error) {
    // Race-safe idempotency: a concurrent create with the same caller id won
    // — return the winner when params are equivalent, else conflict.
    const databaseError = error as { code?: string; cause?: { code?: string } };
    if (params.id && (databaseError?.code ?? databaseError?.cause?.code) === '23505') {
      const existing = await deps.runModel.findById(params.id);
      if (existing) {
        if (!matchesExisting(existing)) throw new Error(RUN_CREATE_ID_CONFLICT, { cause: error });
        return existing;
      }
      throw new Error(RUN_CREATE_ID_CONFLICT, { cause: error });
    }
    throw error;
  }

  if (params.experimentId) {
    await deps.experimentModel.touch(params.experimentId);
  }

  // External runs create Topics/RunTopics on demand (per executed case).
  if (isExternal) return run;

  // Pre-create Topics and RunTopics for all test cases (status='pending')
  const testCases = await deps.testCaseModel.findByDatasetId(datasetId);

  if (testCases.length > 0) {
    await createRunTopics(deps, run.id, targetAgentId, testCases);
  }

  return run;
}

export function createRunTopics(
  deps: EvalRunDeps,
  runId: string,
  targetAgentId: string | null | undefined,
  testCases: Array<{
    content: { input: string; messages?: ImportedMessage[] };
    id: string;
    sortOrder: number | null;
  }>,
) {
  return deps.db.transaction(async (tx) => {
    const preparedCases = testCases.map((testCase) => ({
      testCase,
      topicId: idGenerator('topics'),
    }));

    await tx.insert(topics).values(
      preparedCases.map(({ testCase, topicId }) => ({
        agentId: targetAgentId ?? null,
        id: topicId,
        title: `[${(testCase.sortOrder ?? 0) + 1}] ${testCase.content.input.slice(0, 50) || 'Topic'}...`,
        trigger: 'eval' as const,
        userId: deps.userId,
        workspaceId: deps.workspaceId ?? null,
      })),
    );

    for (const { testCase, topicId } of preparedCases) {
      const history = testCase.content.messages?.filter((message) => message.role !== 'system');
      if (!history?.length) continue;

      const idMapping = new Map<string, string>();
      const hasParentInfo = history.some((message) => message.parentId != null);
      const now = Date.now();
      let previousCreatedAt = Number.NEGATIVE_INFINITY;
      const preparedMessages = history.map((message, index) => {
        const id = idGenerator('messages');
        if (message.id) idMapping.set(message.id, id);

        const timestamp =
          message.createdAt === undefined
            ? now + index
            : typeof message.createdAt === 'number'
              ? message.createdAt
              : Date.parse(message.createdAt);
        const createdAt = Math.max(
          Number.isNaN(timestamp) ? now + index : timestamp,
          previousCreatedAt + 1,
        );
        previousCreatedAt = createdAt;

        const updatedTimestamp =
          message.updatedAt === undefined
            ? createdAt
            : typeof message.updatedAt === 'number'
              ? message.updatedAt
              : Date.parse(message.updatedAt);

        return {
          createdAt,
          id,
          message,
          updatedAt: Math.max(
            Number.isNaN(updatedTimestamp) ? createdAt : updatedTimestamp,
            createdAt,
          ),
        };
      });

      const messageRows = preparedMessages.map(({ createdAt, id, message, updatedAt }, index) => ({
        agentId: null,
        content: message.content,
        createdAt: new Date(createdAt),
        error: message.error ?? null,
        id,
        metadata: message.metadata ?? null,
        model: message.model ?? null,
        parentId: null,
        provider: message.provider ?? null,
        reasoning: message.reasoning ?? null,
        role: message.role,
        search: message.search ?? null,
        tools: message.tools ?? null,
        topicId,
        traceId: message.traceId ?? null,
        updatedAt: new Date(updatedAt),
        userId: deps.userId,
        workspaceId: deps.workspaceId ?? null,
      }));
      const pluginRows = preparedMessages.flatMap(({ id, message }) => {
        if (
          !message.plugin &&
          !message.pluginError &&
          !message.pluginIntervention &&
          !message.pluginState &&
          !message.tool_call_id
        ) {
          return [];
        }

        return [
          {
            apiName: clampToolIdentifier(message.plugin?.apiName) ?? null,
            arguments: message.plugin?.arguments ?? null,
            error: message.pluginError ?? null,
            id,
            identifier: clampToolIdentifier(message.plugin?.identifier) ?? null,
            intervention: message.pluginIntervention as ToolIntervention | undefined,
            state: message.pluginState ?? null,
            toolCallId: message.tool_call_id ?? null,
            type: message.plugin?.type ?? null,
            userId: deps.userId,
            workspaceId: deps.workspaceId ?? null,
          },
        ];
      });

      for (let index = 0; index < messageRows.length; index += EVAL_HISTORY_MESSAGE_BATCH_SIZE) {
        await tx
          .insert(messages)
          .values(messageRows.slice(index, index + EVAL_HISTORY_MESSAGE_BATCH_SIZE));
      }
      const parentLinks = preparedMessages
        .map(({ id, message }, index) => ({
          id,
          parentId: hasParentInfo
            ? message.parentId
              ? (idMapping.get(message.parentId) ?? null)
              : null
            : (preparedMessages[index - 1]?.id ?? null),
        }))
        .filter((link): link is { id: string; parentId: string } => link.parentId !== null);
      for (let index = 0; index < parentLinks.length; index += EVAL_HISTORY_MESSAGE_BATCH_SIZE) {
        const chunk = parentLinks.slice(index, index + EVAL_HISTORY_MESSAGE_BATCH_SIZE);
        await tx
          .update(messages)
          .set({
            parentId: sql`case ${messages.id} ${sql.join(
              chunk.map(({ id, parentId }) => sql`when ${id} then ${parentId}`),
              sql` `,
            )} end`,
          })
          .where(
            inArray(
              messages.id,
              chunk.map(({ id }) => id),
            ),
          );
      }
      for (let index = 0; index < pluginRows.length; index += EVAL_HISTORY_MESSAGE_BATCH_SIZE) {
        await tx
          .insert(messagePlugins)
          .values(pluginRows.slice(index, index + EVAL_HISTORY_MESSAGE_BATCH_SIZE));
      }

      await tx
        .update(topics)
        .set({ metadata: { [EVAL_HISTORY_TAIL_METADATA_KEY]: preparedMessages.at(-1)!.id } })
        .where(eq(topics.id, topicId));
    }

    await tx.insert(agentEvalRunTopics).values(
      preparedCases.map(({ testCase, topicId }) => ({
        runId,
        status: 'pending' as const,
        testCaseId: testCase.id,
        topicId,
        userId: deps.userId,
        workspaceId: deps.workspaceId ?? null,
      })),
    );

    return preparedCases.map(({ topicId }) => topicId);
  });
}

async function snapshotAgentConfig(
  deps: EvalRunDeps,
  agentId: string,
): Promise<EvalRunAgentSnapshot | undefined> {
  const agentConfig = await deps.agentService.getAgentConfigById(agentId);
  if (!agentConfig) return undefined;

  return {
    avatar: agentConfig.avatar,
    chatConfig: agentConfig.chatConfig as unknown as Record<string, unknown>,
    description: null,
    fewShots: agentConfig.fewShots,
    model: agentConfig.model,
    params: agentConfig.params as Record<string, unknown>,
    // Pinned identifiers only — this snapshot is a display-only DTO
    // (EvalRunAgentSnapshot.plugins stays string[]), and a disabled entry
    // isn't part of what actually ran.
    plugins: getActivePluginIds(agentConfig.plugins),
    provider: agentConfig.provider,
    systemRole: agentConfig.systemRole,
    title: agentConfig.title,
  };
}
