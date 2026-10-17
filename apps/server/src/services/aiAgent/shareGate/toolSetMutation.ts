import { PLUGIN_SCHEMA_SEPARATOR } from '@lobechat/const';
import type { LobeToolManifest } from '@lobechat/context-engine';
import { generateToolsFromManifest, ToolNameResolver } from '@lobechat/context-engine';

import { resolveShareToolManifest } from '../shareToolManifest';
import type { ShareGateToolSet } from './types';

/**
 * Single shared resolver instance for regenerating function-calling names
 * from a manifest's identifier/api/type — same class `ToolsEngine` used to
 * build `toolSet.tools` in the first place. Stateless (no per-call config),
 * so one instance is safe to reuse across every gate pass.
 */
const toolNameResolver = new ToolNameResolver();

/**
 * Regenerate the exact function-calling name `ToolsEngine` would have used
 * for each of `apiNames`, via the SAME `ToolNameResolver.generate` it used to
 * build `toolSet.tools` originally.
 *
 * A naive `` `${identifier}${SEP}${apiName}` `` string only matches what is
 * actually in `toolSet.tools` when neither segment needed normalizing.
 * `generate` (1) MD5-hashes an api/identifier segment that contains
 * characters strict providers reject or that pushes the name past the
 * provider length cap, and (2) appends a third `${SEP}<type>` segment for any
 * manifest whose `type` isn't `builtin`/`default` — MCP/connector manifests
 * are `type: 'mcp'` (see `buildConnectorManifests.ts`). Both are common for
 * MCP tools (server-controlled, often long/non-ASCII api names), so skipping
 * this and slicing the raw string instead silently fails OPEN: the manifest
 * loses the API but its generated tool-call name survives in `tools[]` and
 * stays callable.
 */
const generateToolNames = (
  identifier: string,
  apiNames: Iterable<string>,
  type: LobeToolManifest['type'],
): Set<string> => {
  const names = new Set<string>();
  for (const apiName of apiNames) names.add(toolNameResolver.generate(identifier, apiName, type));
  return names;
};

/**
 * Drop every `toolSet.tools` entry that belongs to `identifier` and is not in
 * `allowedNames`. Pass an empty `allowedNames` to drop every entry for the
 * identifier.
 *
 * "Belongs to `identifier`" is decided by `ownedNames` — the full set of
 * generated names for every API on the identifier's manifest, produced by
 * the SAME `ToolNameResolver.generate` that built `toolSet.tools`. A raw
 * first-segment comparison against `identifier` is NOT enough on its own:
 * `generate` MD5-hashes the identifier segment whenever it contains
 * characters strict providers reject (non-ASCII, punctuation) or whenever
 * the assembled name is still over the provider length cap after hashing
 * the api segment, so for such identifiers no entry ever starts with the
 * literal identifier text and a prefix-only match keeps everything —
 * silently failing OPEN. The prefix check is kept only as a fallback for
 * entries that survived without a manifest (nothing to regenerate from).
 */
const pruneToolsForIdentifier = (
  toolSet: ShareGateToolSet,
  identifier: string,
  ownedNames: ReadonlySet<string>,
  allowedNames: ReadonlySet<string>,
): void => {
  if (!toolSet.tools) return;
  pruneArrayInPlace(toolSet.tools, (tool) => {
    const name: string | undefined = tool?.function?.name;
    if (!name) return true;
    const owned = ownedNames.has(name) || name.split(PLUGIN_SCHEMA_SEPARATOR)[0] === identifier;
    if (!owned) return true;
    return allowedNames.has(name);
  });
};

/**
 * Replace surviving function schemas with a builtin-owned restricted
 * projection while preserving which tools the upstream engine activated.
 */
const replaceToolsForIdentifier = (
  toolSet: ShareGateToolSet,
  identifier: string,
  ownedNames: ReadonlySet<string>,
  manifest: LobeToolManifest,
): void => {
  if (!toolSet.tools) return;

  const replacements = new Map(
    generateToolsFromManifest(manifest).map((tool) => [tool.function.name, tool]),
  );

  for (let i = 0; i < toolSet.tools.length; i += 1) {
    const name: string | undefined = toolSet.tools[i]?.function?.name;
    if (!name) continue;

    const owned = ownedNames.has(name) || name.split(PLUGIN_SCHEMA_SEPARATOR)[0] === identifier;
    const replacement = replacements.get(name);
    if (owned && replacement) toolSet.tools[i] = replacement;
  }
};

/** Every generated tool-call name the manifest can currently produce. */
export const generateOwnedToolNames = (
  identifier: string,
  manifest: LobeToolManifest | undefined,
): Set<string> =>
  manifest
    ? generateToolNames(
        identifier,
        manifest.api.map((api) => api.name),
        manifest.type,
      )
    : new Set();

const EMPTY_TOOL_NAME_SET: ReadonlySet<string> = new Set();

/** Remove one tool identifier from every parallel structure of the tool set. */
export const dropToolFromSet = (toolSet: ShareGateToolSet, identifier: string): void => {
  // Regenerate the owned names BEFORE the manifest is gone — it is the only
  // source that can reproduce a hashed identifier segment.
  const ownedNames = generateOwnedToolNames(identifier, toolSet.manifestMap[identifier]);
  delete toolSet.manifestMap[identifier];
  delete toolSet.sourceMap[identifier];
  delete toolSet.executorMap[identifier];
  pruneArrayInPlace(toolSet.enabledToolIds, (id) => id !== identifier);
  pruneArrayInPlace(toolSet.activatableToolIds, (id) => id !== identifier);
  pruneToolsForIdentifier(toolSet, identifier, ownedNames, EMPTY_TOOL_NAME_SET);
};

/** Drop `blockedApiNames` from one tool's manifest AND its function-calling schema. */
export const stripApisFromTool = (
  toolSet: ShareGateToolSet,
  identifier: string,
  blockedApiNames: Set<string>,
): void => {
  const manifest = toolSet.manifestMap[identifier];
  if (!manifest) return;

  const survivingApi = manifest.api.filter((api) => !blockedApiNames.has(api.name));
  const wasTrimmed = survivingApi.length < manifest.api.length;
  const ownedNames = generateOwnedToolNames(identifier, manifest);
  const restrictedManifest = wasTrimmed
    ? resolveShareToolManifest({
        allowedApiNames: survivingApi.map((api) => api.name),
        identifier,
      })
    : undefined;
  const restrictedApiMap = new Map(restrictedManifest?.api.map((api) => [api.name, api]) ?? []);

  // A manifest-level system role commonly documents its complete API surface.
  // Keeping it after a partial strip lets the model infer and advertise APIs
  // that are no longer callable, even though the function schemas are safe.
  // ToolResolver applies the same invariant for per-step tool-name filtering.
  toolSet.manifestMap[identifier] = {
    ...manifest,
    api: survivingApi.map((api) => restrictedApiMap.get(api.name) ?? api),
    meta: restrictedManifest?.meta ?? manifest.meta,
    ...(wasTrimmed && {
      systemRole: restrictedManifest?.systemRole,
    }),
  };

  // Fail-closed: only keep `tools[]` entries this file can PROVE still
  // belong to a surviving API, by regenerating their exact names rather than
  // reverse-parsing whatever is already in `tools[]`.
  pruneToolsForIdentifier(
    toolSet,
    identifier,
    ownedNames,
    generateToolNames(
      identifier,
      survivingApi.map((api) => api.name),
      manifest.type,
    ),
  );

  if (restrictedManifest) {
    replaceToolsForIdentifier(toolSet, identifier, ownedNames, toolSet.manifestMap[identifier]);
  }
};

export const pruneArrayInPlace = <T>(array: T[], keep: (item: T) => boolean): void => {
  for (let i = array.length - 1; i >= 0; i -= 1) {
    if (!keep(array[i])) array.splice(i, 1);
  }
};
