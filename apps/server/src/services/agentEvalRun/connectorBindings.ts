import type {
  EvalCaseEnvironment,
  EvalConnectorBindings,
  EvalConnectorSnapshots,
  EvalRunConfig,
} from '@lobechat/types';

import {
  AgentEvalConnectorService,
  EvalConnectorBindingError,
} from '@/server/services/agentEvalConnector';

import { withResolvedEnvironments } from './caseEnvironment';
import { selectCases } from './caseSelection';
import type { EvalRunDeps } from './types';

export const getCaseConnectorBindings = (
  environment?: EvalCaseEnvironment,
): EvalConnectorBindings => {
  const bindings = environment?.connectorBindings ?? {};
  const required = new Set([
    ...(environment?.mock?.services ?? []),
    ...Object.keys(environment?.toolForwarding ?? {}),
  ]);
  const missing = [...required].filter((identifier) => !Object.hasOwn(bindings, identifier));
  if (missing.length) {
    throw new EvalConnectorBindingError(
      `Bind these mock services to MCP connections in the Dataset Environment before running: ${missing.join(', ')}.`,
    );
  }
  // A case may narrow its shared Environment's service list without copying bindings.
  return environment?.mock || environment?.toolForwarding
    ? Object.fromEntries(
        Object.entries(bindings).filter(([identifier]) => required.has(identifier)),
      )
    : bindings;
};

export async function snapshotCaseConnectors(
  deps: EvalRunDeps,
  testCases: Array<{ content: { environment?: EvalCaseEnvironment }; id: string }>,
) {
  const snapshots: Record<string, EvalConnectorSnapshots> = {};
  const service = new AgentEvalConnectorService(deps.db, deps.userId, deps.workspaceId);
  const checked = new Map<string, Promise<{ snapshots: EvalConnectorSnapshots }>>();
  for (const testCase of testCases) {
    const bindings = getCaseConnectorBindings(testCase.content.environment);
    if (!Object.keys(bindings).length) continue;
    const cacheKey = JSON.stringify(
      Object.entries(bindings).sort(([a], [b]) => a.localeCompare(b)),
    );
    let check = checked.get(cacheKey);
    if (!check) {
      check = service.checkBindings(bindings);
      checked.set(cacheKey, check);
    }
    snapshots[testCase.id] = (await check).snapshots;
  }
  return Object.keys(snapshots).length ? snapshots : undefined;
}

/** Validate the immutable target before changing evidence or starting a new attempt. */
export async function assertCaseConnectorBindings(
  deps: EvalRunDeps,
  environment: EvalCaseEnvironment | undefined,
  expected: EvalConnectorSnapshots | undefined,
  checkConnection = false,
) {
  const bindings = getCaseConnectorBindings(environment);
  if (!Object.keys(bindings).length && !Object.keys(expected ?? {}).length) return;
  if (!expected) {
    throw new EvalConnectorBindingError(
      'This run has no frozen mock connection bindings. Configure its Environment and create a new experiment.',
    );
  }
  const service = new AgentEvalConnectorService(deps.db, deps.userId, deps.workspaceId);
  await service.resolveBindings(bindings, expected);
  if (checkConnection) {
    await service.checkBindings(bindings);
    await service.resolveBindings(bindings, expected);
  }
}

export async function assertRunConnectorBindings(
  deps: EvalRunDeps,
  run: { config?: EvalRunConfig | null; datasetId: string },
  caseIds?: string[],
) {
  const allCases = await deps.testCaseModel.findByDatasetId(run.datasetId);
  const selected = caseIds
    ? allCases.filter((testCase) => caseIds.includes(testCase.id))
    : run.config?.executionMode === 'external'
      ? allCases
      : selectCases(allCases, run.config?.caseSelection);
  const testCases = await withResolvedEnvironments(deps, selected);
  const checked = new Set<string>();
  for (const testCase of testCases) {
    const key = JSON.stringify([
      getCaseConnectorBindings(testCase.content.environment),
      run.config?.connectorSnapshots?.[testCase.id],
    ]);
    if (checked.has(key)) continue;
    checked.add(key);
    await assertCaseConnectorBindings(
      deps,
      testCase.content.environment,
      run.config?.connectorSnapshots?.[testCase.id],
      true,
    );
  }
}
