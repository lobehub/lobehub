import type {
  AgentEvalDatasetPackageBindings,
  AgentEvalDatasetPackageConnectionRequirement,
  EvalConnectorBinding,
} from '@lobechat/types';

export const setConnectorBinding = (
  value: AgentEvalDatasetPackageBindings,
  requirement: AgentEvalDatasetPackageConnectionRequirement,
  service: string,
  binding?: EvalConnectorBinding,
): AgentEvalDatasetPackageBindings => {
  const scope = requirement.scope === 'environment' ? 'environmentBindings' : 'caseBindings';
  const next = { ...value[scope]?.[requirement.key] };
  if (binding) next[service] = binding;
  else delete next[service];
  const groups = { ...value[scope] };
  if (Object.keys(next).length) groups[requirement.key] = next;
  else delete groups[requirement.key];
  return { ...value, [scope]: groups };
};

/** Import overrides replace one complete scope. An untouched scope uses the package or stays unbound. */
export const hasPartialConnectorBindings = (
  requirements: AgentEvalDatasetPackageConnectionRequirement[],
  value: AgentEvalDatasetPackageBindings,
) =>
  requirements.some((requirement) => {
    const bindings =
      value[requirement.scope === 'environment' ? 'environmentBindings' : 'caseBindings']?.[
        requirement.key
      ];
    return !!bindings && requirement.services.some((service) => !bindings[service]?.connectorId);
  });
