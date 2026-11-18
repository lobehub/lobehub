import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { EvalCaseEnvironment, EvalRunConfig } from '@lobechat/types';
import { getActivePluginIds } from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { agents } from '@/database/schemas';

import type { EvalRunDeps } from './types';

/**
 * A model-only run's contender settings, passed to `execAgent` as its chatConfig
 * override. The runtime otherwise drops reasoning-effort fields from the Agent's
 * chatConfig in favour of the account's saved per-model defaults; as an override
 * the contender's choices win, so a run uses the settings it records.
 */
export const contenderChatConfigOf = (run?: { config?: unknown } | null) =>
  (run?.config as EvalRunConfig | null | undefined)?.chatConfig ?? undefined;

/**
 * Per-case hidden Agents.
 *
 * A case that brings its own Agent setup (`environment.agent`), or any case of
 * a run that picks a model instead of an Agent (`config.model`), runs on a
 * `virtual` Agent created for that (run, case) pair. Virtual Agents stay out
 * of the Agent list and recents, the eval topic already stays out of the chat
 * sidebar (`trigger = 'eval'`), and the topic's `agent_id` records which Agent
 * answered — the same shape the Goal supervisor uses.
 *
 * The slug is derived from the run and case ids, so a retried case reuses its
 * Agent and deleting a run can find every Agent it created.
 */

export interface CaseAgentRun {
  config?: EvalRunConfig | null;
  id: string;
  targetAgentId?: string | null;
}

interface CaseAgentTestCase {
  content: { environment?: EvalCaseEnvironment };
  id: string;
  sortOrder: number | null;
}

type BaseAgentConfig = Awaited<ReturnType<EvalRunDeps['agentService']['getAgentConfigById']>>;

export const CASE_AGENT_MODEL_REQUIRED =
  'This run needs a model: choose a target Agent or set config.model and config.provider';

const caseAgentSlugPrefix = (runId: string) => `eval-${runId}-`;

export const caseAgentSlug = (runId: string, testCaseId: string) =>
  `${caseAgentSlugPrefix(runId)}${testCaseId}`;

export const needsCaseAgent = (run: CaseAgentRun, environment?: EvalCaseEnvironment) =>
  !!run.config?.model || !!environment?.agent;

/**
 * Loads what every case Agent of this batch inherits: the run's target Agent
 * (resolved with its defaults, so later edits to that Agent do not leak into a
 * running benchmark), or nothing when the run only picks a model.
 */
export const loadCaseAgentBase = async (
  deps: EvalRunDeps,
  run: CaseAgentRun,
  testCases: CaseAgentTestCase[],
): Promise<BaseAgentConfig | undefined> => {
  if (!run.targetAgentId) return undefined;
  if (!testCases.some((testCase) => needsCaseAgent(run, testCase.content.environment))) {
    return undefined;
  }
  return deps.agentService.getAgentConfigById(run.targetAgentId);
};

const buildCaseAgent = (
  run: CaseAgentRun,
  testCase: CaseAgentTestCase,
  base: BaseAgentConfig | undefined,
) => {
  const caseAgent = testCase.content.environment?.agent;
  const model = run.config?.model ?? base?.model;
  const provider = run.config?.provider ?? base?.provider;
  if (!model || !provider) throw new Error(CASE_AGENT_MODEL_REQUIRED);

  // A model-only run's contender settings override the target Agent's (or the
  // product default) for every case, so two runs of one model with different
  // settings compare the settings, not the cases.
  const baseChatConfig = {
    ...(base?.chatConfig ?? DEFAULT_AGENT_CONFIG.chatConfig),
    ...run.config?.chatConfig,
  };
  const chatConfig = caseAgent?.memory
    ? { ...baseChatConfig, memory: { ...baseChatConfig.memory, ...caseAgent.memory } }
    : baseChatConfig;

  return {
    chatConfig,
    fewShots: base?.fewShots,
    model,
    params: { ...(base?.params ?? DEFAULT_AGENT_CONFIG.params), ...run.config?.params },
    plugins: caseAgent?.plugins ?? (base ? getActivePluginIds(base.plugins) : []),
    provider,
    // Name and title reach the prompt (`<agent_identity>`), so the Agent carries
    // only what the case or the target Agent declares; the eval label lives in
    // the description, which the model never sees.
    description: `Lobe Bench attempt agent for case ${(testCase.sortOrder ?? 0) + 1}`,
    name: caseAgent?.name ?? base?.name ?? null,
    slug: caseAgentSlug(run.id, testCase.id),
    systemRole: caseAgent?.systemRole ?? base?.systemRole ?? '',
    title: caseAgent?.title ?? base?.title ?? null,
    virtual: true,
  };
};

/**
 * Returns the Agent each case's topic belongs to, creating the hidden case
 * Agents that do not exist yet. Runs inside the caller's transaction so a
 * failed topic insert leaves no stray Agents behind.
 */
export const ensureCaseAgents = async (
  tx: LobeChatDatabase,
  deps: EvalRunDeps,
  run: CaseAgentRun,
  testCases: CaseAgentTestCase[],
  base: BaseAgentConfig | undefined,
): Promise<Map<string, string | null>> => {
  const agentModel = new AgentModel(tx, deps.userId, deps.workspaceId);
  const agentIds = new Map<string, string | null>();

  for (const testCase of testCases) {
    if (!needsCaseAgent(run, testCase.content.environment)) {
      agentIds.set(testCase.id, run.targetAgentId ?? null);
      continue;
    }

    const existingId = await agentModel.resolveIdBySlug(caseAgentSlug(run.id, testCase.id));
    if (existingId) {
      agentIds.set(testCase.id, existingId);
      continue;
    }

    const created = await agentModel.create(buildCaseAgent(run, testCase, base));
    agentIds.set(testCase.id, created.id);
  }

  return agentIds;
};

/**
 * The Agent a trajectory runs on is the one its topic belongs to: the case's
 * hidden Agent, or the run's target Agent for runs created before case Agents.
 */
export const resolveTopicAgentId = async (
  deps: EvalRunDeps,
  topicId: string,
  fallbackAgentId?: string | null,
): Promise<string | undefined> => {
  const topic = await deps.topicModel.findById(topicId);
  return topic?.agentId ?? fallbackAgentId ?? undefined;
};

/** Deletes the hidden Agents a run created (their topics cascade with them). */
export const deleteCaseAgents = async (deps: EvalRunDeps, runId: string) => {
  const rows = await deps.db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.userId, deps.userId),
        eq(agents.virtual, true),
        sql`starts_with(${agents.slug}, ${caseAgentSlugPrefix(runId)})`,
      ),
    );
  if (rows.length === 0) return;

  await new AgentModel(deps.db, deps.userId, deps.workspaceId).batchDelete(
    rows.map((row) => row.id),
  );
};
