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
  datasetId: string,
  testCases: Array<{ content: { environment?: EvalCaseEnvironment }; id: string }>,
) {
  const snapshots: Record<string, EvalConnectorSnapshots> = {};
  const service = new AgentEvalConnectorService(deps.db, deps.userId, datasetId, deps.workspaceId);
  const casesWithBindings = testCases
    .map((testCase) => ({
      bindings: getCaseConnectorBindings(testCase.content.environment),
      contracts: testCase.content.environment?.toolManifests,
      id: testCase.id,
    }))
    .filter(({ bindings }) => Object.keys(bindings).length > 0);
  for (const { bindings, contracts } of casesWithBindings) {
    if (Object.keys(bindings).some((id) => !contracts?.[id])) {
      throw new EvalConnectorBindingError(
        'Add the original tool contracts to the Dataset Environment before running.',
      );
    }
  }
  await service.checkBindingGroups(
    casesWithBindings.map(({ bindings }) => bindings),
    casesWithBindings.map(({ contracts }) => contracts),
  );
  const resolved = new Map<string, Promise<{ snapshots: EvalConnectorSnapshots }>>();
  for (const { bindings, contracts, id } of casesWithBindings) {
    const cacheKey = JSON.stringify([
      Object.entries(bindings).sort(([a], [b]) => a.localeCompare(b)),
      contracts,
    ]);
    let resolution = resolved.get(cacheKey);
    if (!resolution) {
      resolution = service.resolveBindings(bindings, undefined, contracts);
      resolved.set(cacheKey, resolution);
    }
    snapshots[id] = (await resolution).snapshots;
  }
  return Object.keys(snapshots).length ? snapshots : undefined;
}

/** Validate the immutable target before changing evidence or starting a new attempt. */
export async function assertCaseConnectorBindings(
  deps: EvalRunDeps,
  datasetId: string | undefined,
  environment: EvalCaseEnvironment | undefined,
  expected: EvalConnectorSnapshots | undefined,
  checkConnection = false,
) {
  const bindings = getCaseConnectorBindings(environment);
  if (!Object.keys(bindings).length && !Object.keys(expected ?? {}).length) return;
  if (!expected || !datasetId) {
    throw new EvalConnectorBindingError(
      'This run has no frozen mock connection bindings. Configure its Environment and create a new experiment.',
    );
  }
  const service = new AgentEvalConnectorService(deps.db, deps.userId, datasetId, deps.workspaceId);
  await service.resolveBindings(bindings, expected, environment?.toolManifests);
  if (checkConnection) {
    await service.checkBindings(bindings);
    await service.resolveBindings(bindings, expected, environment?.toolManifests);
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
  const checks: Array<{
    bindings: EvalConnectorBindings;
    environment: EvalCaseEnvironment | undefined;
    expected: EvalConnectorSnapshots | undefined;
  }> = [];
  for (const testCase of testCases) {
    const environment = testCase.content.environment;
    const expected = run.config?.connectorSnapshots?.[testCase.id];
    const bindings = getCaseConnectorBindings(environment);
    const key = JSON.stringify([bindings, expected]);
    if (checked.has(key)) continue;
    checked.add(key);
    await assertCaseConnectorBindings(deps, run.datasetId, environment, expected);
    checks.push({ bindings, environment, expected });
  }
  const service = new AgentEvalConnectorService(
    deps.db,
    deps.userId,
    run.datasetId,
    deps.workspaceId,
  );
  await service.checkBindingGroups(
    checks.map(({ bindings }) => bindings),
    checks.map(({ environment }) => environment?.toolManifests),
  );
  // Discovery can change tool schemas. Every original alias and frozen contract
  // must still match after synchronization, even when its probe was shared.
  for (const { environment, expected } of checks) {
    await assertCaseConnectorBindings(deps, run.datasetId, environment, expected);
  }
}
