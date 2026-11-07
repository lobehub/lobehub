import type {
  AgentEvalDatasetPackage,
  AgentEvalDatasetPackageBindings,
  AgentEvalDatasetPackageConnectionBindings,
  AgentEvalDatasetPackageConnectionRequirement,
  EvalCaseEnvironment,
  EvalConnectorBindings,
  EvalEnvironmentConnection,
} from '@lobechat/types';
import { environmentConnectionId } from '@lobechat/types';

import { AgentEvalDatasetPackageImportError } from './errors';

export const environmentMockServices = (environment?: EvalCaseEnvironment | null): string[] =>
  [
    ...new Set([
      ...(environment?.mock?.services ?? []),
      ...Object.keys(environment?.toolForwarding ?? {}),
    ]),
  ].sort();

export const effectiveMockServices = (
  shared?: EvalCaseEnvironment | null,
  own?: EvalCaseEnvironment | null,
): string[] =>
  [
    ...new Set([
      ...(own?.mock?.services ?? shared?.mock?.services ?? []),
      ...Object.keys(shared?.toolForwarding ?? {}),
      ...Object.keys(own?.toolForwarding ?? {}),
    ]),
  ].sort();

const withDeclaredServices = (
  config: EvalCaseEnvironment | undefined,
  references?: AgentEvalDatasetPackageConnectionBindings,
  shared?: EvalCaseEnvironment,
): EvalCaseEnvironment | undefined => {
  if (!references || Object.keys(references).length === 0) return config;
  return {
    ...config,
    mock: {
      services: [
        ...new Set([
          ...(config?.mock?.services ?? shared?.mock?.services ?? []),
          ...Object.keys(references),
        ]),
      ].sort(),
    },
  };
};

/**
 * A connection belongs to an Environment, never to one case: a case only
 * chooses which of its Environment's services it uses (`mock.services`).
 */
export const assertEnvironmentOnlyConnections = (pack: AgentEvalDatasetPackage) => {
  const offered = new Map(
    pack.environments.map((environment) => [
      environment.key,
      new Set([
        ...environmentMockServices(environment.config),
        ...Object.keys(environment.connectionBindings ?? {}),
      ]),
    ]),
  );
  for (const testCase of pack.cases) {
    if (Object.keys(testCase.connectionBindings ?? {}).length > 0)
      throw new AgentEvalDatasetPackageImportError(
        'Mock connections belong to an Environment. A case cannot bind its own; list the services it uses in its Environment instead.',
      );
    const services = environmentMockServices(testCase.content.environment);
    if (services.length === 0) continue;
    const available = testCase.environmentKey ? offered.get(testCase.environmentKey) : undefined;
    if (!available || services.some((service) => !available.has(service)))
      throw new AgentEvalDatasetPackageImportError(
        'A case can only use mock services its Environment provides.',
      );
  }
};

export const getPackageConnectionRequirements = (
  pack: AgentEvalDatasetPackage,
): AgentEvalDatasetPackageConnectionRequirement[] =>
  pack.environments
    .map((environment) => ({
      key: environment.key,
      name: environment.name,
      providedServices: Object.keys(environment.connectionBindings ?? {}).sort(),
      scope: 'environment' as const,
      services: environmentMockServices(
        withDeclaredServices(environment.config, environment.connectionBindings),
      ),
    }))
    .filter((requirement) => requirement.services.length > 0);

/** Supplied selections are complete; omitting a scope keeps embedded or unbound requirements. */
export const assertCompleteConnectorBindings = (
  services: string[],
  bindings: EvalConnectorBindings,
) => {
  const aliases = Object.keys(bindings).sort();
  if (
    services.length !== aliases.length ||
    services.some((service, index) => service !== aliases[index])
  ) {
    throw new AgentEvalDatasetPackageImportError(
      'Select one mock connection for every required service, without additional services',
    );
  }
};

export const validatePackageConnectionSelections = (
  pack: AgentEvalDatasetPackage,
  selections: AgentEvalDatasetPackageBindings = {},
) => {
  assertEnvironmentOnlyConnections(pack);
  if (Object.keys(selections.caseBindings ?? {}).length > 0)
    throw new AgentEvalDatasetPackageImportError(
      'Mock connections belong to an Environment. Choose them for the Environment, not for a case.',
    );
  const requirements = getPackageConnectionRequirements(pack);
  for (const [key, bindings] of Object.entries(selections.environmentBindings ?? {})) {
    const requirement = requirements.find((item) => item.key === key);
    if (!requirement) {
      throw new AgentEvalDatasetPackageImportError('The selected package environment is unknown');
    }
    assertCompleteConnectorBindings(requirement.services, bindings);
  }
};

/** The package connections the import stores: those Environments it does not rebind use. */
export const getReferencedPackageConnections = (
  pack: AgentEvalDatasetPackage,
  selections: AgentEvalDatasetPackageBindings = {},
): string[] => [
  ...new Set(
    pack.environments.flatMap((environment) =>
      Object.hasOwn(selections.environmentBindings ?? {}, environment.key)
        ? []
        : Object.values(environment.connectionBindings ?? {}).map(
            (binding) => binding.connectionKey,
          ),
    ),
  ),
];

/**
 * Binds a package for import. Every package connection is stored, encrypted,
 * in the Environment that uses it (`config.connections`) and bound by its
 * `env:<environmentId>:<service>` id; an Environment the importer rebinds keeps
 * the connections chosen for it. Cases keep their own settings unchanged.
 */
export const bindDatasetPackage = (
  pack: AgentEvalDatasetPackage,
  selections: AgentEvalDatasetPackageBindings = {},
  inline?: {
    /** The encrypted connections, by package connection key. */
    connections: ReadonlyMap<string, EvalEnvironmentConnection>;
    /** The id each Environment row will get, by package key. */
    environmentIds: ReadonlyMap<string, string>;
  },
) => {
  validatePackageConnectionSelections(pack, selections);
  const environments = pack.environments.map((environment) => {
    const config = withDeclaredServices(environment.config, environment.connectionBindings) ?? {};
    if (Object.hasOwn(selections.environmentBindings ?? {}, environment.key)) {
      const bindings = selections.environmentBindings![environment.key];
      return {
        ...environment,
        config: { ...config, ...(Object.keys(bindings).length && { connectorBindings: bindings }) },
      };
    }
    const environmentId = inline?.environmentIds.get(environment.key);
    const references = Object.entries(environment.connectionBindings ?? {});
    if (references.length === 0) return { ...environment, config };
    if (!environmentId)
      throw new AgentEvalDatasetPackageImportError('A package mock connection is unavailable');
    const connections: Record<string, EvalEnvironmentConnection> = {};
    const connectorBindings: EvalConnectorBindings = {};
    for (const [alias, reference] of references) {
      const connection = inline?.connections.get(reference.connectionKey);
      if (!connection)
        throw new AgentEvalDatasetPackageImportError('A package mock connection is unavailable');
      connections[alias] = connection;
      connectorBindings[alias] = {
        connectorId: environmentConnectionId(environmentId, alias),
        ...(reference.transport && { transport: reference.transport }),
      };
    }
    return {
      ...environment,
      id: environmentId,
      config: { ...config, connections, connectorBindings },
    };
  });
  return { ...pack, environments };
};
