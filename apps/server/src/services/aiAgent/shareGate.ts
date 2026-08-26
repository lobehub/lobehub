import {
  AgentDocumentsApiName,
  AgentDocumentsIdentifier,
} from '@lobechat/builtin-tool-agent-documents';
import {
  AgentManagementApiName,
  AgentManagementIdentifier,
  systemPromptWithoutCallAgent,
} from '@lobechat/builtin-tool-agent-management';
import {
  KnowledgeBaseApiName,
  KnowledgeBaseIdentifier,
} from '@lobechat/builtin-tool-knowledge-base';
import {
  LobeAgentApiName,
  LobeAgentIdentifier,
  systemPromptWithoutSubAgent,
} from '@lobechat/builtin-tool-lobe-agent';
import { MemoryApiName, MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import type { LobeToolManifest, ToolExecutor, ToolSource } from '@lobechat/context-engine';

import type { AgentShareConfig } from '@/database/schemas';

/**
 * Separator between a tool identifier and its API name in a generated
 * function-call name (e.g. `lobe-activator____activateTools`). Mirrors
 * `PLUGIN_SCHEMA_SEPARATOR` in `@lobechat/context-engine`'s `ToolNameResolver`
 * — not re-exported from there, so duplicated here for the `tools` filter
 * below rather than reaching into the engine's internal module.
 */
const PLUGIN_SCHEMA_SEPARATOR = '____';

/**
 * Server-side gate for shared-agent visitor conversations (agent share C4).
 *
 * Built exclusively by the shareChat router after the share access check —
 * never from client input. The gate is applied at operation-build time inside
 * `AiAgentService.execAgentWithReservation`, so the restricted tool/memory/file
 * surface is snapshotted into the operation state and every later step
 * inherits it without the context engine knowing about shares.
 */
export interface AgentShareGate {
  agentId: string;
  shareConfig: AgentShareConfig;
  /**
   * The signed-in visitor driving this run. Recorded on `topics.senderId` and
   * spend-log metadata; the run itself executes as the creator.
   */
  visitorUserId: string;
}

/**
 * Intersect a run's candidate plugin/skill ids with the share whitelist.
 * The whitelist defaults to empty, so an unconfigured share exposes no tools.
 */
export const filterPluginsByShareGate = (pluginIds: string[], gate: AgentShareGate): string[] => {
  const allowed = new Set(gate.shareConfig.enabledToolIds ?? []);

  return pluginIds.filter((id) => allowed.has(id));
};

/**
 * Strip agent files / knowledge bases the share config does not expose to
 * visitors. Mutates the resolved config in place — `agentConfig` is threaded
 * through the whole orchestration by reference (tool discovery, knowledge
 * flags, context builder snapshot), so a filtered copy would silently diverge.
 */
export const applyShareGateToAgentConfig = (
  agentConfig: { files?: unknown[] | null; knowledgeBases?: unknown[] | null },
  gate: AgentShareGate,
): void => {
  const filePermission = gate.shareConfig.filePermissionConfig;

  if (filePermission?.agentFiles !== 'read') agentConfig.files = [];
  if (filePermission?.knowledgeBase !== 'read') agentConfig.knowledgeBases = [];
};

/**
 * Minimal shape a `DataToolAccessRule.grant` needs — either the full share
 * gate's `shareConfig`, or the trimmed `agentShare` marker threaded through
 * `RuntimeExecutorContext` / `ToolExecutionContext` for tool calls resolved
 * outside this module (see `isShareBlockedDataToolCall`).
 */
interface ShareDataToolPermissions {
  allowReadMemory?: boolean;
  filePermissionConfig?: AgentShareConfig['filePermissionConfig'];
}

type DataToolGrant = 'none' | 'read';

/**
 * Read/write surface of a builtin tool whose APIs act directly on the
 * creator's private data store (memory, knowledge bases, agent documents).
 *
 * Unlike ordinary plugins, these tools are gated by two independent axes:
 * whether the share grants ANY access at all (`grant`), and — since v1 share
 * grants are `none` | `read` only, there is no write grant to honor — whether
 * a given API is a write regardless of grant (`writeApiNames`).
 */
interface DataToolAccessRule {
  /** Resolve this share's grant for the tool from its permission fields. */
  grant: (permissions: ShareDataToolPermissions) => DataToolGrant;
  /** API names that mutate creator data; stripped/blocked unconditionally. */
  writeApiNames: string[];
}

/**
 * Registry of data-bearing builtin tools a share visitor can be whitelisted
 * into (`shareConfig.enabledToolIds`) without the whitelist itself implying
 * read OR write access to the underlying store. `filterPluginsByShareGate` /
 * `applyShareGateToToolSet`'s allowlist intersection only answers "is this
 * tool id enabled for the share" — it says nothing about `allowReadMemory` or
 * `filePermissionConfig`, which is why a whitelisted memory/knowledge-base/
 * agent-documents tool previously executed read-write under the creator's
 * own permissions no matter what the share granted.
 *
 * Adding a new write API to one of these packages must add it here too —
 * `shareGate.test.ts` asserts against the REAL exported manifests, so a
 * rename or omission fails that test instead of silently reopening the hole.
 */
const DATA_TOOL_ACCESS_RULES: Record<string, DataToolAccessRule> = {
  [AgentDocumentsIdentifier]: {
    grant: (permissions) =>
      permissions.filePermissionConfig?.agentFiles === 'read' ? 'read' : 'none',
    writeApiNames: [
      AgentDocumentsApiName.createDocument,
      AgentDocumentsApiName.copyDocument,
      AgentDocumentsApiName.modifyNodes,
      AgentDocumentsApiName.removeDocument,
      AgentDocumentsApiName.renameDocument,
      AgentDocumentsApiName.replaceDocumentContent,
      AgentDocumentsApiName.updateLoadRule,
    ],
  },
  [KnowledgeBaseIdentifier]: {
    grant: (permissions) =>
      permissions.filePermissionConfig?.knowledgeBase === 'read' ? 'read' : 'none',
    writeApiNames: [
      KnowledgeBaseApiName.createKnowledgeBase,
      KnowledgeBaseApiName.deleteKnowledgeBase,
      KnowledgeBaseApiName.createDocument,
      KnowledgeBaseApiName.addFiles,
      KnowledgeBaseApiName.removeFiles,
    ],
  },
  [MemoryIdentifier]: {
    grant: (permissions) => (permissions.allowReadMemory ? 'read' : 'none'),
    writeApiNames: [
      MemoryApiName.addActivityMemory,
      MemoryApiName.addContextMemory,
      MemoryApiName.addExperienceMemory,
      MemoryApiName.addIdentityMemory,
      MemoryApiName.addPreferenceMemory,
      MemoryApiName.removeIdentityMemory,
      MemoryApiName.updateIdentityMemory,
    ],
  },
};

/**
 * Whether a specific `identifier`/`apiName` tool call must be blocked for a
 * share visitor run. This is the enforcement counterpart of
 * `applyShareGateToDataToolAccess` below, reusable from the actual dispatch
 * chokepoint (`BuiltinToolsExecutor.execute`, which invokes
 * `runtime[apiName](...)` directly and never consults the manifest that
 * `applyShareGateToDataToolAccess` trims — the trimmed manifest only changes
 * what the model is OFFERED via function-calling schema, not what the
 * executor is willing to run if the model calls it anyway).
 *
 * Fails closed: an identifier with no rule is unaffected (ordinary plugins,
 * gated only by the C1 allowlist); an identifier WITH a rule but no
 * `permissions` (a non-share run never reaches here) is not this function's
 * concern — callers only invoke it when `agentShare` is set.
 */
export const isShareBlockedDataToolCall = (
  permissions: ShareDataToolPermissions,
  identifier: string,
  apiName: string,
): boolean => {
  const rule = DATA_TOOL_ACCESS_RULES[identifier];
  if (!rule) return false;

  const grant = rule.grant(permissions);
  if (grant === 'none') return true;

  return rule.writeApiNames.includes(apiName);
};

/**
 * Apply `DATA_TOOL_ACCESS_RULES` to the assembled tool set: drop a data tool
 * entirely when its grant is `none`, or strip its write APIs (from both the
 * manifest and the function-calling `tools` schema) when the grant is
 * `read`. Runs as part of `applyShareGateToToolSet` — after that pass's
 * allowlist intersection has already decided which identifiers survive at
 * all — so this only needs to further restrict, never re-add.
 *
 * This is UX/defense-in-depth (the model is never offered the disallowed
 * function); the actual unbypassable enforcement is
 * `isShareBlockedDataToolCall` at the `BuiltinToolsExecutor` dispatch site.
 */
const applyShareGateToDataToolAccess = (toolSet: ShareGateToolSet, gate: AgentShareGate): void => {
  for (const [identifier, rule] of Object.entries(DATA_TOOL_ACCESS_RULES)) {
    if (!toolSet.manifestMap[identifier]) continue;

    const grant = rule.grant(gate.shareConfig);

    if (grant === 'none') {
      delete toolSet.manifestMap[identifier];
      delete toolSet.sourceMap[identifier];
      delete toolSet.executorMap[identifier];
      pruneArrayInPlace(toolSet.enabledToolIds, (id) => id !== identifier);
      pruneArrayInPlace(toolSet.activatableToolIds, (id) => id !== identifier);
      if (toolSet.tools) {
        pruneArrayInPlace(toolSet.tools, (tool) => {
          const toolIdentifier = tool?.function?.name?.split(PLUGIN_SCHEMA_SEPARATOR)?.[0];
          return toolIdentifier !== identifier;
        });
      }
      continue;
    }

    const manifest = toolSet.manifestMap[identifier];
    toolSet.manifestMap[identifier] = {
      ...manifest,
      api: manifest.api.filter((api) => !rule.writeApiNames.includes(api.name)),
    };

    if (toolSet.tools) {
      pruneArrayInPlace(toolSet.tools, (tool) => {
        const name: string | undefined = tool?.function?.name;
        if (!name?.startsWith(`${identifier}${PLUGIN_SCHEMA_SEPARATOR}`)) return true;

        const apiName = name.slice(identifier.length + PLUGIN_SCHEMA_SEPARATOR.length);
        return !rule.writeApiNames.includes(apiName);
      });
    }
  }
};

/**
 * The assembled operation-level tool set, right before it is handed to
 * `AgentRuntimeService.createOperation` as `toolSet`.
 */
export interface ShareGateToolSet {
  activatableToolIds: string[];
  enabledToolIds: string[];
  executorMap: Record<string, ToolExecutor>;
  manifestMap: Record<string, LobeToolManifest>;
  sourceMap: Record<string, ToolSource>;
  tools: any[] | undefined;
}

/**
 * Final allowlist enforcement for a share visitor's fully-assembled tool set
 * (agent share C1).
 *
 * `shareConfig.enabledToolIds` is the single source of truth for what a share
 * visitor can see or run. This pass mutates `toolSet` in place and must run
 * once, after every manifest/default/dynamic-activation source has been
 * merged in, immediately before the operation's `toolSet` is persisted. An
 * empty/missing whitelist collapses the set to nothing (no built-in tool is
 * exempted; a share with no configured tools is a plain-chat run).
 */
export const applyShareGateToToolSet = (toolSet: ShareGateToolSet, gate: AgentShareGate): void => {
  const allowed = new Set(gate.shareConfig.enabledToolIds ?? []);
  const isAllowed = (id: string) => allowed.has(id);

  // Prune arrays in place (`splice`, not reassignment) so this works whether
  // the caller's binding for `enabledToolIds` / `activatableToolIds` / `tools`
  // is a `const` array reference — callers only need to pass the array they
  // already hold, not receive a new one back.
  pruneArrayInPlace(toolSet.enabledToolIds, isAllowed);
  pruneArrayInPlace(toolSet.activatableToolIds, isAllowed);

  for (const id of Object.keys(toolSet.manifestMap)) {
    if (!isAllowed(id)) delete toolSet.manifestMap[id];
  }
  for (const id of Object.keys(toolSet.sourceMap)) {
    if (!isAllowed(id)) delete toolSet.sourceMap[id];
  }
  for (const id of Object.keys(toolSet.executorMap)) {
    if (!isAllowed(id)) delete toolSet.executorMap[id];
  }

  if (toolSet.tools) {
    pruneArrayInPlace(toolSet.tools, (tool) => {
      const identifier = tool?.function?.name?.split(PLUGIN_SCHEMA_SEPARATOR)?.[0];
      return !!identifier && isAllowed(identifier);
    });
  }

  stripSubAgentDispatchApis(toolSet);
  applyShareGateToDataToolAccess(toolSet, gate);
};

/**
 * Sub-agent dispatch is not available in shared visitor runs. This strip runs
 * unconditionally on `lobe-agent-management` / `lobe-agent`, independent of
 * whether the manifest was resolved through the normal context-aware path, so
 * a whitelisted entry can never surface `callAgent` / `callSubAgent` — nor a
 * `systemRole` that instructs the model to call them — to a share visitor's
 * model or the activator. `lobe-agent` already ships a precise systemRole
 * variant without the dispatch section (`systemPromptWithoutSubAgent`, also
 * used by its own context-aware `resolveManifest`); `lobe-agent-management`'s
 * equivalent (`systemPromptWithoutCallAgent`) mirrors that.
 */
const SUB_AGENT_DISPATCH_APIS: Record<
  string,
  { apiName: string; systemRoleWithoutDispatch: string }
> = {
  [AgentManagementIdentifier]: {
    apiName: AgentManagementApiName.callAgent,
    systemRoleWithoutDispatch: systemPromptWithoutCallAgent,
  },
  [LobeAgentIdentifier]: {
    apiName: LobeAgentApiName.callSubAgent,
    systemRoleWithoutDispatch: systemPromptWithoutSubAgent,
  },
};

const stripSubAgentDispatchApis = (toolSet: ShareGateToolSet): void => {
  for (const [identifier, { apiName, systemRoleWithoutDispatch }] of Object.entries(
    SUB_AGENT_DISPATCH_APIS,
  )) {
    const manifest = toolSet.manifestMap[identifier];
    if (manifest) {
      // Always pin the sanitized `systemRole`, not only when `api` still
      // carries the dispatch entry — an already context-aware-trimmed
      // manifest (api filtered upstream) could otherwise keep a stale
      // `systemRole` that still instructs the model to call the removed tool.
      toolSet.manifestMap[identifier] = {
        ...manifest,
        api: manifest.api.filter((api) => api.name !== apiName),
        systemRole: systemRoleWithoutDispatch,
      };
    }

    if (toolSet.tools) {
      const dispatchToolName = `${identifier}${PLUGIN_SCHEMA_SEPARATOR}${apiName}`;
      pruneArrayInPlace(toolSet.tools, (tool) => tool?.function?.name !== dispatchToolName);
    }
  }
};

const pruneArrayInPlace = <T>(array: T[], keep: (item: T) => boolean): void => {
  for (let i = array.length - 1; i >= 0; i -= 1) {
    if (!keep(array[i])) array.splice(i, 1);
  }
};
