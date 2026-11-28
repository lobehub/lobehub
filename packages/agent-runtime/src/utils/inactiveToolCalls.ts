const PLUGIN_SCHEMA_SEPARATOR = '____';
const ACTIVATE_TOOLS_NAME = 'lobe-activator____activateTools';

interface ManifestLike {
  api?: Array<{ name?: string }>;
}

/**
 * The tool identifier an unresolved call names when that tool is real but only
 * needs activating, or `undefined` for a genuine typo.
 *
 * In agent mode on-demand builtins (Agent Management, Task, Creds, ...) stay
 * out of the offered functions until `lobe-activator____activateTools` loads
 * them, even when the agent pins them. The model can still name one exactly:
 * an earlier turn called it, and the activation that made it callable fell out
 * of the history window, so the next operation does not restore it. Telling
 * that model to "copy a name exactly" sends it back to the same exact name
 * until the unresolved-name budget ends the run (lobehub#23684).
 *
 * Only counts as inactive when the run's manifest map (the discovery pool)
 * holds the identifier, its manifest declares the API, the tool is not already
 * activated, and the activator is offered, so the hint never points the model
 * at an activation it cannot do or has already done. A name with a type suffix
 * (`____mcp`, `____standalone`) is a wire-format mismatch, not an inactive
 * tool, so it keeps the typo feedback.
 */
export const findInactiveToolIdentifier = (
  name: string,
  manifestMap: Record<string, ManifestLike | undefined>,
  offeredToolNames: ReadonlySet<string>,
  activatedToolIds: ReadonlySet<string>,
): string | undefined => {
  if (!offeredToolNames.has(ACTIVATE_TOOLS_NAME)) return undefined;

  const parts = name.split(PLUGIN_SCHEMA_SEPARATOR);
  if (parts.length !== 2) return undefined;
  const [identifier, apiName] = parts;
  if (!identifier || !apiName || activatedToolIds.has(identifier)) return undefined;

  const manifest = manifestMap[identifier];
  if (!manifest?.api?.some((api) => api.name === apiName)) return undefined;

  return identifier;
};

export const buildInactiveToolContent = (names: string[], identifiers: string[]) =>
  `Tool call rejected: ${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} not activated in this run. Call ${ACTIVATE_TOOLS_NAME} with identifiers ${JSON.stringify([...new Set(identifiers)])} first, then call it again.`;
