import type { LobeToolManifest } from '@lobechat/context-engine';
import type { BuiltinToolResolveContext, LobeBuiltinTool } from '@lobechat/types';
import debug from 'debug';

const log = debug('mecha:manifestPool');

/** A connector tool's permission as the connectors settings store it. */
export type ConnectorToolPermissionValue = 'auto' | 'disabled' | 'needs_approval';

/** Per-tool permissions of one connector, keyed by tool name. */
export type ConnectorToolPermissions = Map<string, ConnectorToolPermissionValue | string>;

export interface ConnectorToolFacts {
  description?: string | null;
  inputSchema?: unknown;
  permission?: ConnectorToolPermissionValue | string | null;
  toolName: string;
}

export interface ConnectorFacts {
  identifier: string;
  isEnabled?: boolean | null;
  name: string;
  tools: ConnectorToolFacts[];
}

/**
 * What the model reads for a tool the user switched off: it stays listed so
 * the model can explain why it will not act, and the execution path blocks
 * it regardless.
 */
export const disabledToolDescription = (toolName: string): string =>
  `[TOOL DISABLED] The user has disabled this tool and it cannot be executed. ` +
  `Do NOT call this tool. If the user asks to perform this action, inform them ` +
  `that they have manually disabled "${toolName}" and can re-enable it in Settings > Connectors.`;

/**
 * Patch a manifest's `api[]` with connector tool permissions:
 * `needs_approval` → `humanIntervention: 'required'`; `disabled` → the
 * blocking description plus `humanIntervention: 'required'`. The disabled
 * hard-block is enforced separately at execution time; this surfaces the
 * permission to the model and the approval prompt.
 */
export function patchManifestWithPermissions<M extends { api: readonly { name: string }[] }>(
  manifest: M,
  toolPermissions: ConnectorToolPermissions,
): M {
  const patchedApi = manifest.api.map((api) => {
    const permission = toolPermissions.get(api.name);
    if (permission === 'disabled') {
      return {
        ...api,
        description: disabledToolDescription(api.name),
        humanIntervention: 'required' as const,
      };
    }
    if (permission === 'needs_approval') {
      return { ...api, humanIntervention: 'required' as const };
    }
    return api;
  });
  return { ...manifest, api: patchedApi as M['api'] };
}

/**
 * A connector's tools as one MCP manifest: every synced tool is listed
 * (disabled ones with the blocking description), permissions become
 * `humanIntervention`. Returns nothing for a disabled connector or one with no
 * synced tools — such a connector must not replace a same-named plugin while
 * contributing nothing to call.
 */
export const buildConnectorManifest = (connector: ConnectorFacts): LobeToolManifest | undefined => {
  if (!connector.isEnabled) return undefined;
  if (connector.tools.length === 0) return undefined;

  const api = connector.tools.map((tool) => {
    const parameters = (tool.inputSchema ?? { properties: {}, type: 'object' }) as Record<
      string,
      unknown
    >;
    if (tool.permission === 'disabled') {
      return {
        description: disabledToolDescription(tool.toolName),
        humanIntervention: 'required' as const,
        name: tool.toolName,
        parameters,
      };
    }
    return {
      description: tool.description ?? '',
      humanIntervention: tool.permission === 'needs_approval' ? ('required' as const) : undefined,
      name: tool.toolName,
      parameters,
    };
  });

  return {
    api,
    identifier: connector.identifier,
    meta: {
      avatar: 'MCP_AVATAR',
      description: `${connector.name} connector with ${api.length} tools`,
      title: connector.name,
    },
    type: 'mcp',
  };
};

/**
 * A manifest is usable by the tools engine only if it has an `api` array;
 * anything else would crash the whole tools build. Sources that populate
 * manifests (installed plugins, Composio, LobeHub skills, MCP) have no shared
 * schema validation, so guard at the merge point.
 */
const isValidToolManifest = (m: unknown): m is LobeToolManifest =>
  !!m && typeof m === 'object' && Array.isArray((m as { api?: unknown }).api);

export const dropInvalidManifests = (
  manifests: readonly (LobeToolManifest | undefined | null)[],
  source: string,
): LobeToolManifest[] => {
  const valid: LobeToolManifest[] = [];
  const dropped: { identifier?: string; reason: string }[] = [];
  for (const m of manifests) {
    if (isValidToolManifest(m)) valid.push(m);
    else if (m)
      dropped.push({
        identifier: (m as { identifier?: string }).identifier,
        reason: 'missing `api` field (expected array)',
      });
  }
  if (dropped.length > 0) {
    log('Dropped %d invalid manifest(s) from %s: %O', dropped.length, source, dropped);
    console.warn(
      `[manifestPool] Dropped ${dropped.length} invalid manifest(s) from ${source}:`,
      dropped,
    );
  }
  return valid;
};

export interface ManifestPoolSources {
  /** Anything the host adds beyond the standard sources. */
  additional?: readonly (LobeToolManifest | undefined)[];
  /** Builtin tools; context-aware ones resolve their manifest for `manifestContext`. */
  builtinTools?: readonly Pick<LobeBuiltinTool, 'identifier' | 'manifest' | 'resolveManifest'>[];
  composio?: readonly (LobeToolManifest | undefined)[];
  /** Real MCP connectors (with an endpoint) that produced a manifest. */
  connectors?: readonly (LobeToolManifest | undefined)[];
  /** The user's installed plugins, before connector precedence. */
  installedPlugins?: readonly (LobeToolManifest | undefined)[];
  lobehubSkills?: readonly (LobeToolManifest | undefined)[];
}

export interface AssembleManifestPoolOptions {
  /**
   * Connector tool permissions keyed by connector identifier, for tools the
   * connector system manages but that execute through another path (LobeHub
   * skills, Composio, community-MCP plugins). Connectors that produced their
   * own manifest already carry them.
   */
  connectorPermissions?: ReadonlyMap<string, ConnectorToolPermissions>;
  /** Identifiers that must not exist in the pool, from any source. */
  excludedIdentifiers?: Iterable<string>;
  /**
   * Runtime context for context-aware builtin manifests: each builtin with a
   * `resolveManifest` produces its manifest for this context (trimming APIs
   * or opting out). Omit for context-free callers, which get the static ones.
   */
  manifestContext?: BuiltinToolResolveContext;
}

export interface ManifestPool {
  /** Identifiers served by a connector manifest; same-named plugins were dropped. */
  connectorIdentifiers: Set<string>;
  manifests: LobeToolManifest[];
}

/**
 * The manifest pool a tools engine may resolve tools from. Rules: a connector
 * that produced a manifest replaces the same-named plugin; manifests executed
 * outside the connector path get the connector's tool permissions patched in;
 * context-aware builtins resolve for the run; every source drops entries the
 * engine could not use; excluded identifiers are removed from every source.
 */
export const assembleManifestPool = (
  sources: ManifestPoolSources,
  options: AssembleManifestPoolOptions = {},
): ManifestPool => {
  const { connectorPermissions, manifestContext } = options;
  const connectorManifests = dropInvalidManifests(sources.connectors ?? [], 'connectors');
  const connectorIdentifiers = new Set(connectorManifests.map((m) => m.identifier));

  const withPermissions = (manifest: LobeToolManifest): LobeToolManifest => {
    const perms = connectorPermissions?.get(manifest.identifier);
    return perms && perms.size > 0 ? patchManifestWithPermissions(manifest, perms) : manifest;
  };

  const pluginManifests = dropInvalidManifests(sources.installedPlugins ?? [], 'installedPlugins')
    .filter((m) => !connectorIdentifiers.has(m.identifier))
    .map(withPermissions);
  const builtinManifests = dropInvalidManifests(
    (sources.builtinTools ?? []).map((tool) =>
      manifestContext && tool.resolveManifest
        ? (tool.resolveManifest(manifestContext) as LobeToolManifest | null)
        : (tool.manifest as LobeToolManifest),
    ),
    'builtinTools',
  );
  const composioManifests = dropInvalidManifests(sources.composio ?? [], 'composio').map(
    withPermissions,
  );
  const lobehubSkillManifests = dropInvalidManifests(
    sources.lobehubSkills ?? [],
    'lobehubSkills',
  ).map(withPermissions);
  const additionalManifests = dropInvalidManifests(sources.additional ?? [], 'additionalManifests');

  const excluded = new Set(options.excludedIdentifiers ?? []);
  const manifests = [
    ...pluginManifests,
    ...builtinManifests,
    ...composioManifests,
    ...lobehubSkillManifests,
    ...connectorManifests,
    ...additionalManifests,
  ].filter((m) => !excluded.has(m.identifier));

  return { connectorIdentifiers, manifests };
};
