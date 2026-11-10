import type { LobeToolManifest, ToolExecutor, ToolSource } from '@lobechat/context-engine';
import { generateToolsFromManifest, ToolNameResolver } from '@lobechat/context-engine';
import { disabledToolDescription } from '@lobechat/mecha';

import { CODE_MODE_IDENTIFIER, CODE_MODE_MIN_TOOL_COUNT } from './constants';
import { buildCodeModeManifest, type CodeModeConnector } from './manifest';

/** The operation-level tool set, mutated in place like the share and eval gates do. */
export interface CodeModeToolSet {
  activatableToolIds: string[];
  enabledToolIds: string[];
  executorMap: Record<string, ToolExecutor>;
  manifestMap: Record<string, LobeToolManifest>;
  sourceMap: Record<string, ToolSource>;
  /** LLM function definitions (`UniformTool`); typed loosely like the share gate's set. */
  tools: any[] | undefined;
}

export interface CodeModeCollapseResult {
  collapsedToolIds: string[];
  /** Connector tools (APIs) now reached through `execute` instead of their own function. */
  toolCount: number;
}

const isDisabledApi = (api: LobeToolManifest['api'][number]) =>
  api.description === disabledToolDescription(api.name);

/** Approval cannot be asked for halfway through a script, so such a tool keeps its own function. */
const needsApproval = (api: LobeToolManifest['api'][number]) =>
  !!(api as { humanIntervention?: unknown }).humanIntervention && !isDisabledApi(api);

/**
 * Whether a manifest can be served from a script: a server-executed MCP
 * connector none of whose tools waits for a human. Client-dispatched tools
 * (stdio MCP with no device gateway) run in the browser and can't be reached
 * from the server-side sandbox.
 */
const isCollapsible = (identifier: string, manifest: LobeToolManifest, toolSet: CodeModeToolSet) =>
  manifest.type === 'mcp' &&
  !!(manifest as { mcpParams?: unknown }).mcpParams &&
  toolSet.executorMap[identifier] !== 'client' &&
  toolSet.sourceMap[identifier] !== 'client' &&
  manifest.api.length > 0 &&
  !manifest.api.some(needsApproval);

/**
 * Fold the run's MCP connector tools into the single Code Mode tool.
 *
 * Only enabled connectors are folded; their manifests stay in `manifestMap`
 * (the execution path reads the connection params from there) but leave
 * `enabledToolIds`, `activatableToolIds` and `tools`, so neither their function
 * definitions nor their system roles reach the model. Below
 * `minToolCount` collapsible tools the set is left untouched.
 *
 * Returns `undefined` when nothing was folded.
 */
export const applyCodeModeToToolSet = (
  toolSet: CodeModeToolSet,
  { minToolCount = CODE_MODE_MIN_TOOL_COUNT }: { minToolCount?: number } = {},
): CodeModeCollapseResult | undefined => {
  if (!toolSet.tools || toolSet.enabledToolIds.includes(CODE_MODE_IDENTIFIER)) return undefined;

  const connectors: CodeModeConnector[] = [];
  const collapsed: LobeToolManifest[] = [];
  let toolCount = 0;

  for (const identifier of new Set(toolSet.enabledToolIds)) {
    const manifest = toolSet.manifestMap[identifier];
    if (!manifest || !isCollapsible(identifier, manifest, toolSet)) continue;

    const toolNames = manifest.api.filter((api) => !isDisabledApi(api)).map((api) => api.name);
    toolCount += toolNames.length;
    collapsed.push(manifest);
    connectors.push({
      identifier,
      title: manifest.meta?.title || identifier,
      toolNames,
    });
  }

  if (toolCount < minToolCount) return undefined;

  const collapsedIds = new Set(collapsed.map((manifest) => manifest.identifier));
  const resolver = new ToolNameResolver();
  const collapsedFunctionNames = new Set(
    collapsed.flatMap((manifest) =>
      manifest.api.map((api) => resolver.generate(manifest.identifier, api.name, manifest.type)),
    ),
  );

  const keepTools = toolSet.tools.filter((tool) => !collapsedFunctionNames.has(tool.function.name));
  toolSet.tools.splice(0, toolSet.tools.length, ...keepTools);

  const keepEnabled = toolSet.enabledToolIds.filter((id) => !collapsedIds.has(id));
  toolSet.enabledToolIds.splice(0, toolSet.enabledToolIds.length, ...keepEnabled);

  const keepActivatable = toolSet.activatableToolIds.filter((id) => !collapsedIds.has(id));
  toolSet.activatableToolIds.splice(0, toolSet.activatableToolIds.length, ...keepActivatable);

  const manifest = buildCodeModeManifest(connectors);
  toolSet.manifestMap[CODE_MODE_IDENTIFIER] = manifest;
  toolSet.sourceMap[CODE_MODE_IDENTIFIER] = 'builtin';
  toolSet.enabledToolIds.push(CODE_MODE_IDENTIFIER);
  toolSet.tools.push(...generateToolsFromManifest(manifest));

  return { collapsedToolIds: [...collapsedIds], toolCount };
};
