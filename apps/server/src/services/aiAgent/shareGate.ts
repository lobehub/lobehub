import {
  AgentDocumentsApiName,
  AgentDocumentsIdentifier,
} from '@lobechat/builtin-tool-agent-documents';
import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
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
  /**
   * Agent's own persisted, `enabled` knowledge-base ids (never
   * visitor-supplied — see `AgentShareGate`'s `knowledgeBaseIds` producer in
   * `aiAgent/index.ts`). The only thing in `DATA_TOOL_ACCESS_RULES` that
   * needs an id allowlist today: `viewKnowledgeBase`'s `id` argument.
   */
  knowledgeBaseIds?: string[];
}

type DataToolGrant = 'none' | 'read';

/**
 * Read/write surface of a builtin tool whose APIs act directly on the
 * creator's private data store (memory, knowledge bases, agent documents).
 *
 * Unlike ordinary plugins, these tools are gated by three independent axes:
 * whether the share grants ANY access at all (`grant`); — since v1 share
 * grants are `none` | `read` only, there is no write grant to honor — whether
 * a given API is a write regardless of grant (`writeApiNames`); and whether a
 * "read" API can even be scoped to what the share actually grants at all
 * (`alwaysBlockedApiNames`, `isArgsOutOfScope`) — some reads act on the
 * caller's ENTIRE personal data store with no id parameter tying them to the
 * agent's own assignment, so a `read` grant must not enable them.
 */
interface DataToolAccessRule {
  /**
   * API names that read across the creator's whole personal store
   * (independent of what this specific agent is assigned) with no id
   * argument that could scope the call — e.g. `lobe-knowledge-base`'s
   * `listFiles` / `getFileDetail` (the creator's whole resource library) and
   * `listKnowledgeBases` / `readKnowledge` (every knowledge base / file the
   * creator owns, not just what's mounted on this agent). Always blocked for
   * a share visitor, even when `grant` is `read` — unlike `writeApiNames`,
   * these ARE reads, but a read grant only ever means "read what this agent
   * is assigned," never "read everything the creator owns."
   */
  alwaysBlockedApiNames?: string[];
  /** Resolve this share's grant for the tool from its permission fields. */
  grant: (permissions: ShareDataToolPermissions) => DataToolGrant;
  /**
   * For an API that DOES take an id scoping it to a specific resource (e.g.
   * `viewKnowledgeBase`'s `id`): whether the id(s) `args` references fall
   * outside what this share's permissions actually allow. Absent for APIs
   * with no such id, or already covered by `writeApiNames` /
   * `alwaysBlockedApiNames`. Must fail closed — an id that cannot be
   * verified (missing, wrong type, or the allowlist itself is empty/absent)
   * is out of scope.
   */
  isArgsOutOfScope?: (permissions: ShareDataToolPermissions, apiName: string, args: any) => boolean;
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
    // `listFiles` / `getFileDetail` browse the creator's whole resource
    // library (files not yet in any knowledge base) — that library has no
    // per-agent assignment concept at all, so no grant can scope it to "what
    // this agent is assigned." `listKnowledgeBases` lists every knowledge
    // base the creator owns, not just the ones mounted on this agent, and
    // takes no id to scope it either. `readKnowledge` accepts arbitrary
    // `file_*`/`docs_*` ids read straight from the creator's file/document
    // store with no knowledge-base-membership check of its own — validating
    // that server-side would require resolving each id's knowledge-base
    // membership (a join `searchKnowledgeBase`'s own scoping already needs),
    // which this gate does not have the DB access to do id-by-id. Blocking it
    // is the fail-closed choice: `searchKnowledgeBase` (already agent/task-id
    // scoped server-side, see `resolveAgentKnowledgeBaseIds` in
    // `serverRuntimes/knowledgeBase.ts`) still returns real chunk/document
    // text, so a `read` grant remains useful without this hole.
    alwaysBlockedApiNames: [
      KnowledgeBaseApiName.listFiles,
      KnowledgeBaseApiName.getFileDetail,
      KnowledgeBaseApiName.listKnowledgeBases,
      KnowledgeBaseApiName.readKnowledge,
    ],
    grant: (permissions) =>
      permissions.filePermissionConfig?.knowledgeBase === 'read' ? 'read' : 'none',
    // `viewKnowledgeBase` DOES take an `id`, and the agent's own assignment
    // is known (`ShareDataToolPermissions.knowledgeBaseIds`) — so unlike the
    // APIs above, this one can be honestly scoped instead of blocked outright.
    isArgsOutOfScope: (permissions, apiName, args) => {
      if (apiName !== KnowledgeBaseApiName.viewKnowledgeBase) return false;
      const id = args?.id;
      if (typeof id !== 'string' || !id) return true;
      const allowed = permissions.knowledgeBaseIds;
      return !allowed || !allowed.includes(id);
    },
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
 * `applyShareGateToDataToolAccess` / `stripAlwaysBlockedIdentifiers` below,
 * reusable from the actual dispatch chokepoint (`BuiltinToolsExecutor.execute`,
 * which invokes `runtime[apiName](...)` directly and never consults the
 * manifest that those trim — the trimmed manifest only changes what the model
 * is OFFERED via function-calling schema, not what the executor is willing to
 * run if the model calls it anyway).
 *
 * Fails closed: an identifier with no rule and not in
 * `SHARE_VISITOR_BLOCKED_IDENTIFIERS` is unaffected (ordinary plugins, gated
 * only by the C1 allowlist); an identifier WITH a rule but no `permissions`
 * (a non-share run never reaches here) is not this function's concern —
 * callers only invoke it when `agentShare` is set.
 *
 * `args` is the tool call's parsed arguments, needed only for
 * `isArgsOutOfScope` rules (e.g. `viewKnowledgeBase`'s `id`). Omit it for
 * call sites that only need the identifier/apiName-level check (grant /
 * write / always-blocked) — an id-scoped API without `args` fails closed via
 * `isArgsOutOfScope`'s own missing-id handling once `args` is supplied.
 */
export const isShareBlockedDataToolCall = (
  permissions: ShareDataToolPermissions,
  identifier: string,
  apiName: string,
  args?: any,
): boolean => {
  // Whole-identifier block (e.g. `lobe-agent-management`, see
  // `SHARE_VISITOR_BLOCKED_IDENTIFIERS`) — every API on the tool is unsafe
  // for a share visitor, so no `apiName`-level distinction is needed here.
  if (SHARE_VISITOR_BLOCKED_IDENTIFIERS.has(identifier)) return true;

  const rule = DATA_TOOL_ACCESS_RULES[identifier];
  if (!rule) return false;

  const grant = rule.grant(permissions);
  if (grant === 'none') return true;

  if (rule.writeApiNames.includes(apiName)) return true;
  if (rule.alwaysBlockedApiNames?.includes(apiName)) return true;
  if (args !== undefined && rule.isArgsOutOfScope?.(permissions, apiName, args)) return true;

  return false;
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

    // Under a `read` grant, strip both mutations (`writeApiNames`) AND the
    // creator-wide reads that no grant can honestly scope to this agent
    // (`alwaysBlockedApiNames`) — same treatment, since both are never
    // offered to the model regardless of grant. `isArgsOutOfScope`-covered
    // APIs (e.g. `viewKnowledgeBase`) are NOT stripped here: they stay
    // offered because they CAN be in scope depending on the id the model
    // picks, and that per-call id check only runs at dispatch time
    // (`isShareBlockedDataToolCall`), not against a static manifest.
    const blockedApiNames = new Set([...rule.writeApiNames, ...(rule.alwaysBlockedApiNames ?? [])]);

    const manifest = toolSet.manifestMap[identifier];
    toolSet.manifestMap[identifier] = {
      ...manifest,
      api: manifest.api.filter((api) => !blockedApiNames.has(api.name)),
    };

    if (toolSet.tools) {
      pruneArrayInPlace(toolSet.tools, (tool) => {
        const name: string | undefined = tool?.function?.name;
        if (!name?.startsWith(`${identifier}${PLUGIN_SCHEMA_SEPARATOR}`)) return true;

        const apiName = name.slice(identifier.length + PLUGIN_SCHEMA_SEPARATOR.length);
        return !blockedApiNames.has(apiName);
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
  stripAlwaysBlockedIdentifiers(toolSet);
  applyShareGateToDataToolAccess(toolSet, gate);
};

/**
 * Builtin tool identifiers whose ENTIRE API surface must never reach a share
 * visitor's model or tool set — as opposed to `DATA_TOOL_ACCESS_RULES`, which
 * trims a tool down to a scoped subset, or `SUB_AGENT_DISPATCH_APIS`, which
 * hides only one dispatch API. These tools have no honest per-API scoping to
 * keep at all: every API runs against the CREATOR's private data with a
 * visitor-suppliable id argument that is never checked against the shared
 * agent itself.
 *
 * - `lobe-agent-management`: executes in `agentManagementRuntime`
 *   (`apps/server/src/services/toolExecution/serverRuntimes/agentManagement.ts`)
 *   scoped by `userId` (the creator — the run executes as the creator, see
 *   `AgentShareGate`), but `agentId` is a free-form model argument on nearly
 *   every API. `searchAgent` (source: 'user') enumerates the creator's whole
 *   workspace; `getAgentDetail` returns any creator-owned agent's full
 *   config (system prompt included) for an arbitrary id; `createAgent` /
 *   `updateAgent` / `updatePrompt` / `duplicateAgent` / `installPlugin`
 *   persistently mutate the creator's agent collection. `callAgent` is
 *   already covered by `SUB_AGENT_DISPATCH_APIS`, but the rest of the tool
 *   has no API worth keeping, so the whole identifier is removed — fail
 *   closed rather than allowlist API-by-API. Mirrored by `resolveAgentManagementManifest`
 *   returning `null` for `isShareVisitor` (defense in depth: this strip is
 *   unconditional here too, independent of whether that context-aware path
 *   ran) and by the dispatch-time block in `isShareBlockedDataToolCall`.
 */
const SHARE_VISITOR_BLOCKED_IDENTIFIERS = new Set<string>([AgentManagementIdentifier]);

const stripAlwaysBlockedIdentifiers = (toolSet: ShareGateToolSet): void => {
  for (const identifier of SHARE_VISITOR_BLOCKED_IDENTIFIERS) {
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
  }
};

/**
 * Sub-agent dispatch is not available in shared visitor runs. This strip runs
 * unconditionally on `lobe-agent`, independent of whether the manifest was
 * resolved through the normal context-aware path, so a whitelisted entry can
 * never surface `callSubAgent` — nor a `systemRole` that instructs the model
 * to call it — to a share visitor's model or the activator. `lobe-agent`
 * already ships a precise systemRole variant without the dispatch section
 * (`systemPromptWithoutSubAgent`, also used by its own context-aware
 * `resolveManifest`).
 *
 * `lobe-agent-management`'s dispatch API (`callAgent`) does NOT need an entry
 * here: the whole tool — dispatch included — is removed by
 * `SHARE_VISITOR_BLOCKED_IDENTIFIERS` above.
 */
const SUB_AGENT_DISPATCH_APIS: Record<
  string,
  { apiName: string; systemRoleWithoutDispatch: string }
> = {
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
