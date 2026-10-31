import type { EvalCaseEnvironment } from '@lobechat/types';

import type { EvalRunDeps } from './types';

/**
 * A case's environment is its shared environment row (`environmentId`) with
 * the case's own `content.environment` laid over it: a case tweaks a field
 * (another clock, one more tool) without copying the rest. Cases without an
 * environment row keep working on their own `content.environment`.
 */
export const mergeCaseEnvironment = (
  shared: EvalCaseEnvironment | null | undefined,
  own: EvalCaseEnvironment | null | undefined,
): EvalCaseEnvironment | undefined => {
  if (!shared) return own ?? undefined;
  if (!own) return shared;
  return {
    ...shared,
    ...own,
    ...(shared.agent || own.agent
      ? {
          agent: {
            ...shared.agent,
            ...own.agent,
            ...(shared.agent?.memory || own.agent?.memory
              ? { memory: { ...shared.agent?.memory, ...own.agent?.memory } }
              : {}),
          },
        }
      : {}),
    ...(shared.mock || own.mock
      ? { mock: { services: own.mock?.services ?? shared.mock?.services ?? [] } }
      : {}),
    ...(shared.toolForwarding || own.toolForwarding
      ? { toolForwarding: { ...shared.toolForwarding, ...own.toolForwarding } }
      : {}),
  };
};

interface CaseWithEnvironment {
  content: { environment?: EvalCaseEnvironment };
  environmentId?: string | null;
}

/**
 * Returns the cases with `content.environment` resolved against their shared
 * environments (one batch read). Every eval stage that reads a case
 * environment goes through this, so the rest of the chain never knows whether
 * the environment was shared or the case's own.
 */
export async function withResolvedEnvironments<T extends CaseWithEnvironment>(
  deps: EvalRunDeps,
  testCases: T[],
): Promise<T[]> {
  const ids = testCases.map((testCase) => testCase.environmentId).filter(Boolean) as string[];
  if (ids.length === 0) return testCases;
  const rows = await deps.environmentModel.findByIds(ids);
  const byId = new Map(rows.map((row) => [row.id, row.config]));
  return testCases.map((testCase) => {
    const shared = testCase.environmentId ? byId.get(testCase.environmentId) : undefined;
    if (!shared) return testCase;
    return {
      ...testCase,
      content: {
        ...testCase.content,
        environment: mergeCaseEnvironment(shared, testCase.content.environment),
      },
    };
  });
}

export const withResolvedEnvironment = async <T extends CaseWithEnvironment>(
  deps: EvalRunDeps,
  testCase: T,
): Promise<T> => (await withResolvedEnvironments(deps, [testCase]))[0];
