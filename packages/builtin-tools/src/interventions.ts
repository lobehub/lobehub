import type { BuiltinIntervention } from '@lobechat/types';

/**
 * Builtin tools interventions registry
 * Organized by toolset (identifier) -> API name
 * Only register APIs that have custom intervention UI
 */
const builtinToolInterventions: Record<string, Record<string, BuiltinIntervention>> = {};

export const registerBuiltinInterventions = (
  entries: Record<string, Record<string, BuiltinIntervention>>,
): void => {
  for (const [identifier, interventions] of Object.entries(entries)) {
    const current = builtinToolInterventions[identifier];
    builtinToolInterventions[identifier] = current
      ? Object.assign(current, interventions)
      : interventions;
  }
};

export interface BuiltinInterventionRegistryEntry {
  apiName: string;
  identifier: string;
  intervention: BuiltinIntervention;
}

export const listBuiltinInterventionEntries = (): BuiltinInterventionRegistryEntry[] =>
  Object.entries(builtinToolInterventions).flatMap(([identifier, toolset]) =>
    Object.entries(toolset)
      .filter((entry): entry is [string, BuiltinIntervention] => !!entry[1])
      .map(([apiName, intervention]) => ({
        apiName,
        identifier,
        intervention,
      })),
  );

/**
 * Get builtin intervention component for a specific API
 * @param identifier - Tool identifier (e.g., 'lobe-local-system')
 * @param apiName - API name (e.g., 'runCommand')
 */
export const getBuiltinIntervention = (
  identifier?: string,
  apiName?: string,
): BuiltinIntervention | undefined => {
  if (!identifier || !apiName) return undefined;

  const toolset = builtinToolInterventions[identifier];
  if (!toolset) return undefined;

  return toolset[apiName];
};
