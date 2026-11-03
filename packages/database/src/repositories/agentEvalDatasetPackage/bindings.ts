import type {
  AgentEvalDatasetPackage,
  AgentEvalDatasetPackageBindings,
  AgentEvalDatasetPackageConnectionBindings,
  AgentEvalDatasetPackageConnectionRequirement,
  EvalCaseEnvironment,
  EvalConnectorBindings,
} from '@lobechat/types';

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

export const getPackageConnectionRequirements = (
  pack: AgentEvalDatasetPackage,
): AgentEvalDatasetPackageConnectionRequirement[] => {
  const shared = new Map(
    pack.environments.map((environment) => [
      environment.key,
      withDeclaredServices(environment.config, environment.connectionBindings),
    ]),
  );
  return [
    ...pack.environments.map((environment) => ({
      key: environment.key,
      name: environment.name,
      providedServices: Object.keys(environment.connectionBindings ?? {}).sort(),
      scope: 'environment' as const,
      services: environmentMockServices(shared.get(environment.key)),
    })),
    ...pack.cases
      .filter(
        (testCase) =>
          environmentMockServices(testCase.content.environment).length > 0 ||
          Object.keys(testCase.connectionBindings ?? {}).length > 0,
      )
      .map((testCase) => {
        const parent = testCase.environmentKey ? shared.get(testCase.environmentKey) : undefined;
        const own = withDeclaredServices(
          testCase.content.environment,
          testCase.connectionBindings,
          parent,
        );
        const services = effectiveMockServices(parent, own);
        const parentEntry = pack.environments.find(
          (environment) => environment.key === testCase.environmentKey,
        );
        return {
          key: testCase.key,
          name: testCase.key,
          providedServices: [
            ...new Set([
              ...Object.keys(parentEntry?.connectionBindings ?? {}),
              ...Object.keys(testCase.connectionBindings ?? {}),
            ]),
          ]
            .filter((service) => services.includes(service))
            .sort(),
          scope: 'case' as const,
          services,
        };
      }),
  ].filter((requirement) => requirement.services.length > 0);
};

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
  const requirements = getPackageConnectionRequirements(pack);
  for (const [scope, selected] of [
    ['environment', selections.environmentBindings],
    ['case', selections.caseBindings],
  ] as const) {
    for (const [key, bindings] of Object.entries(selected ?? {})) {
      const requirement = requirements.find((item) => item.scope === scope && item.key === key);
      if (!requirement) {
        throw new AgentEvalDatasetPackageImportError(
          'The selected package environment or case is unknown',
        );
      }
      assertCompleteConnectorBindings(requirement.services, bindings);
    }
  }
};

export const getReferencedPackageConnections = (
  pack: AgentEvalDatasetPackage,
  selections: AgentEvalDatasetPackageBindings = {},
): string[] => [
  ...new Set([
    ...pack.environments.flatMap((environment) =>
      Object.hasOwn(selections.environmentBindings ?? {}, environment.key)
        ? []
        : Object.values(environment.connectionBindings ?? {}).map(
            (binding) => binding.connectionKey,
          ),
    ),
    ...pack.cases.flatMap((testCase) =>
      Object.hasOwn(selections.caseBindings ?? {}, testCase.key)
        ? []
        : Object.values(testCase.connectionBindings ?? {}).map((binding) => binding.connectionKey),
    ),
  ]),
];

export const bindDatasetPackage = (
  pack: AgentEvalDatasetPackage,
  selections: AgentEvalDatasetPackageBindings = {},
  connectionIds: ReadonlyMap<string, string> = new Map(),
) => {
  validatePackageConnectionSelections(pack, selections);
  const resolve = (references?: AgentEvalDatasetPackageConnectionBindings): EvalConnectorBindings =>
    Object.fromEntries(
      Object.entries(references ?? {}).map(([alias, reference]) => {
        const connectorId = connectionIds.get(reference.connectionKey);
        if (!connectorId)
          throw new AgentEvalDatasetPackageImportError('A package mock connection is unavailable');
        return [
          alias,
          { connectorId, ...(reference.transport && { transport: reference.transport }) },
        ];
      }),
    );
  const environments = pack.environments.map((environment) => {
    const bindings = Object.hasOwn(selections.environmentBindings ?? {}, environment.key)
      ? selections.environmentBindings![environment.key]
      : resolve(environment.connectionBindings);
    return {
      ...environment,
      config: {
        ...withDeclaredServices(environment.config, environment.connectionBindings),
        ...(Object.keys(bindings).length && { connectorBindings: bindings }),
      },
    };
  });
  const shared = new Map(environments.map((environment) => [environment.key, environment.config]));
  const cases = pack.cases.map((testCase) => {
    const parent = testCase.environmentKey ? shared.get(testCase.environmentKey) : undefined;
    const own = withDeclaredServices(
      testCase.content.environment,
      testCase.connectionBindings,
      parent,
    );
    const hasOwnBinding =
      Object.hasOwn(selections.caseBindings ?? {}, testCase.key) ||
      Object.keys(testCase.connectionBindings ?? {}).length > 0;
    if (!hasOwnBinding)
      return { ...testCase, content: { ...testCase.content, ...(own && { environment: own }) } };
    const services = effectiveMockServices(parent, own);
    const bindings = Object.hasOwn(selections.caseBindings ?? {}, testCase.key)
      ? selections.caseBindings![testCase.key]
      : Object.fromEntries(
          Object.entries({
            ...parent?.connectorBindings,
            ...resolve(testCase.connectionBindings),
          }).filter(([service]) => services.includes(service)),
        );
    return {
      ...testCase,
      content: { ...testCase.content, environment: { ...own, connectorBindings: bindings } },
    };
  });
  return { ...pack, cases, environments };
};
