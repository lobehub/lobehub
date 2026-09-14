import pMap from 'p-map';

import { resolveAgentBuilderContextFacts } from './agentBuilderContext';
import { resolveAgentDocumentFacts } from './agentDocuments';
import { resolveComposioServicesVariable } from './composioServices';
import { resolveCredsListVariable } from './credsList';
import { resolveGroupAgentBuilderContextFacts } from './groupAgentBuilderContext';
import { resolveLobehubSkillVariables } from './lobehubSkillVariables';
import { resolveOnboardingContextFacts } from './onboardingContext';
import { resolvePlanTodoFacts } from './planTodo';
import { resolveSandboxVariables } from './sandboxVariables';
import { resolveTopicReferenceFacts } from './topicReferences';
import type { ServerContextFactInput } from './types';
import { resolveUserInfoVariables } from './userInfoVariables';
import { resolveWorkspaceContextFacts } from './workspaceContext';

export type { ServerContextFactInput } from './types';

/**
 * How many lookups run at once. Most providers hit Postgres through the same
 * pool, and a few reach external services (market, Composio); capping the
 * fan-out keeps one step from grabbing a dozen connections at once.
 */
export const PROVIDER_CONCURRENCY = 8;

type Settled<T extends readonly (() => Promise<unknown>)[]> = {
  [K in keyof T]: Awaited<ReturnType<T[K]>>;
};

/** `Promise.all` over thunks with a concurrency cap, keeping each position's type. */
const runBounded = <T extends readonly (() => Promise<unknown>)[]>(
  tasks: T,
  concurrency: number,
): Promise<Settled<T>> => pMap(tasks, (task) => task(), { concurrency }) as Promise<Settled<T>>;

/**
 * Everything the server gathers per step for the context snapshot, grouped
 * the way the snapshot consumes it. Each provider is independent and
 * best-effort, so they run concurrently (bounded by
 * {@link PROVIDER_CONCURRENCY}): a step pays for the slowest lookup, not the
 * sum of them.
 */
export const gatherServerContextFacts = async (input: ServerContextFactInput) => {
  const [
    agentBuilderContext,
    agentDocuments,
    composioServicesList,
    credsList,
    groupAgentBuilderContext,
    lobehubSkill,
    onboardingContext,
    planTodo,
    sandbox,
    topicReferences,
    userInfo,
    workspaceContext,
  ] = await runBounded(
    [
      () => resolveAgentBuilderContextFacts(input),
      () => resolveAgentDocumentFacts(input),
      () => resolveComposioServicesVariable(input),
      () => resolveCredsListVariable(input),
      () => resolveGroupAgentBuilderContextFacts(input),
      () => resolveLobehubSkillVariables(input),
      () => resolveOnboardingContextFacts(input),
      () => resolvePlanTodoFacts(input),
      () => resolveSandboxVariables(input),
      () => resolveTopicReferenceFacts(input),
      () => resolveUserInfoVariables(input),
      () => resolveWorkspaceContextFacts(input),
    ] as const,
    PROVIDER_CONCURRENCY,
  );

  return {
    agentDocuments,
    step: {
      agentBuilderContext,
      groupAgentBuilderContext,
      onboardingContext,
      planTodo,
      topicReferences,
      workspaceContext,
    },
    variables: {
      ...lobehubSkill,
      ...sandbox,
      COMPOSIO_SERVICES_LIST: composioServicesList,
      CREDS_LIST: credsList,
      language: userInfo.language,
      username: userInfo.username,
    },
  };
};
