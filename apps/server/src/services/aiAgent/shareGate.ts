import {
  AgentDocumentsApiName,
  AgentDocumentsIdentifier,
} from '@lobechat/builtin-tool-agent-documents';
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
import {
  AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS,
  isBuiltinToolIdentifier,
} from '@lobechat/builtin-tools';
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

/**
 * Master allowlist of builtin tool identifiers a share visitor's run may ever
 * touch, at BOTH the tool-set-assembly layer (`applyShareGateToToolSet`) and
 * the dispatch layer (`isShareBlockedDataToolCall`, called from
 * `BuiltinToolsExecutor.execute`).
 *
 * DEFAULT-DENY, not default-allow-minus-a-blocklist. A share visitor's run
 * executes with the CREATOR's full credentials (see `AgentShareGate`), and
 * every builtin runtime defaults to creator-scoped — it is written for the
 * creator's own conversation, where "the caller" and "the data owner" are the
 * same person. A share visitor breaks that assumption (caller ≠ data owner),
 * and nothing about a builtin tool's manifest or registration signals whether
 * its runtime happens to re-derive its scope from a model-suppliable
 * argument (unsafe for a visitor) or purely from server-side context like
 * `context.agentId` / `context.operationId` (safe). Five review rounds each
 * surfaced one more tool that leaked the creator's whole account under the
 * previous denylist (`SHARE_VISITOR_BLOCKED_IDENTIFIERS` — removed, see the
 * bottom of this file for what replaced it) precisely because "not yet
 * proven unsafe" defaulted to "exposed." Under this allowlist, a newly
 * registered builtin tool — or a newly added API on an already-allowed one —
 * is exposed to a share visitor ONLY once someone explicitly adds it here
 * with the file:line evidence for why its runtime cannot resolve to the
 * creator's data outside what this specific share/agent grants.
 *
 * Defined in `@lobechat/builtin-tools` (`AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS`,
 * along with `isBuiltinToolIdentifier` / `isAgentShareAllowedBuiltinIdentifier`)
 * rather than here, so the owner-facing share settings tool picker
 * (`AgentShareSettings/SettingsContent.tsx`) can import the EXACT same allowlist
 * the server enforces instead of hand-copying identifiers that could drift —
 * see that package's JSDoc for the per-identifier safety evidence and the
 * denied-bucket rationale for every identifier NOT on the list.
 *
 * Governs ONLY builtin tool identifiers (checked via `isBuiltinToolIdentifier`
 * against the real `@lobechat/builtin-tools` registry). MCP servers, market
 * plugins, and custom plugins are a different population, gated exclusively
 * by `filterPluginsByShareGate` (the owner's `enabledToolIds` picker) — they
 * must never be matched against this set, in either direction: an unknown
 * non-builtin id must not be silently allowed through as "not a known
 * builtin, so no rule applies" NOR silently blocked as "not on the builtin
 * allowlist." See `isBuiltinToolIdentifier`.
 */
const SHARE_VISITOR_ALLOWED_IDENTIFIERS = AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS;

/**
 * Whether `identifier` belongs to the population this allowlist governs — the
 * real builtin tool registry (`@lobechat/builtin-tools`), the same source
 * `BuiltinToolsExecutor`/`hasServerRuntime` resolve against. MCP servers,
 * market plugins (source `'lobehubSkill'`/`'composio'`), and custom plugins
 * never appear in this registry, so they fall outside this allowlist's
 * jurisdiction entirely and are left to `filterPluginsByShareGate` /
 * `shareConfig.enabledToolIds` — the pre-existing (and unaffected) gate for
 * that population.
 */
const isGovernedByBuiltinAllowlist = isBuiltinToolIdentifier;

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
 * `applyShareGateToDataToolAccess` below, reusable from the actual dispatch
 * chokepoint (`BuiltinToolsExecutor.execute`, which invokes
 * `runtime[apiName](...)` directly and never re-consults the (possibly
 * already-trimmed) manifest — the trimmed manifest only changes what the
 * model is OFFERED via function-calling schema, not what the executor is
 * willing to run if the model calls it anyway).
 *
 * DEFAULT-DENY for the builtin population: an `identifier` that resolves
 * against the real `@lobechat/builtin-tools` registry
 * (`isGovernedByBuiltinAllowlist`) but is NOT in
 * `SHARE_VISITOR_ALLOWED_IDENTIFIERS` is blocked outright, with no
 * `apiName`-level distinction — this is what replaced the old
 * `SHARE_VISITOR_BLOCKED_IDENTIFIERS` denylist (e.g. `lobe-agent-management`,
 * `lobe-creds`, `lobe-message`, `lobe-skill-store`, `lobe-agent-builder`,
 * `lobe-skills`, `lobe-group-agent-builder`, `lobe-group-management`,
 * `lobe-task`, `lobe-skill-maintainer`, `agent-signal-skill-management` — see
 * `SHARE_VISITOR_ALLOWED_IDENTIFIERS`'s JSDoc for why each is absent). A
 * non-builtin identifier (MCP server, market plugin, custom plugin) is NOT
 * this function's concern at all — it falls through to `false` untouched,
 * left entirely to `filterPluginsByShareGate` / `shareConfig.enabledToolIds`.
 *
 * An identifier WITH a `DATA_TOOL_ACCESS_RULES` entry but no `permissions`
 * (a non-share run never reaches here) is not this function's concern either
 * — callers only invoke it when `agentShare` is set.
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
  // Outside this gate's jurisdiction entirely — MCP/market/custom plugin
  // identifiers are governed by the enabledToolIds picker, not this allowlist.
  if (!isGovernedByBuiltinAllowlist(identifier)) return false;

  // Default-deny: a known builtin identifier not on the allowlist is blocked
  // unconditionally, including any tool registered after this allowlist was
  // written — the whole point of inverting the old denylist.
  if (!SHARE_VISITOR_ALLOWED_IDENTIFIERS.has(identifier)) return true;

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
  const ownerAllowed = new Set(gate.shareConfig.enabledToolIds ?? []);

  // A tool must clear BOTH gates: the owner's own `enabledToolIds` picker
  // (`ownerAllowed`, pre-existing), AND — for builtin identifiers only — the
  // default-deny master allowlist (`SHARE_VISITOR_ALLOWED_IDENTIFIERS`).
  // Non-builtin identifiers (MCP/market/custom plugins) are outside
  // `isGovernedByBuiltinAllowlist`'s population, so they pass straight
  // through to the owner-picker check unaffected — this allowlist must never
  // decide their fate, in either direction.
  const isAllowed = (id: string) => {
    if (!ownerAllowed.has(id)) return false;
    if (!isGovernedByBuiltinAllowlist(id)) return true;
    return SHARE_VISITOR_ALLOWED_IDENTIFIERS.has(id);
  };

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
 * Rationale for every registered builtin identifier that is DENIED — i.e.
 * absent from `SHARE_VISITOR_ALLOWED_IDENTIFIERS` above. Under the old
 * denylist (`SHARE_VISITOR_BLOCKED_IDENTIFIERS`, removed — its members are
 * simply absent from the allowlist now, no separate set needed since the
 * allowlist itself is the single source of truth) an identifier had to be
 * explicitly proven dangerous to be blocked; under the allowlist an
 * identifier has to be explicitly proven safe to be exposed, so this comment
 * exists purely to record the evidence trail for reviewers — the denial
 * itself needs no code beyond "not in the Set above."
 *
 * Confirmed leak paths (a concrete visitor→creator-data route was found):
 *
 * - `lobe-agent-management`: executes in `agentManagementRuntime`
 *   (`apps/server/src/services/toolExecution/serverRuntimes/agentManagement.ts`)
 *   scoped by `userId` (the creator — the run executes as the creator, see
 *   `AgentShareGate`), but `agentId` is a free-form model argument on nearly
 *   every API. `searchAgent` (source: 'user') enumerates the creator's whole
 *   workspace; `getAgentDetail` returns any creator-owned agent's full
 *   config (system prompt included) for an arbitrary id; `createAgent` /
 *   `updateAgent` / `updatePrompt` / `duplicateAgent` / `installPlugin`
 *   persistently mutate the creator's agent collection. `callAgent` is the
 *   sub-agent dispatch API also covered by `SUB_AGENT_DISPATCH_APIS` for
 *   `lobe-agent`, but the rest of this tool has no API worth keeping — fail
 *   closed rather than allowlist API-by-API. Mirrored by
 *   `resolveAgentManagementManifest` returning `null` for `isShareVisitor`
 *   (defense in depth).
 *
 * - `agent-signal-review`: registered by `agentSignalReviewRuntime`
 *   (`serverRuntimes/agentSignalReview.ts:36-74`), which DOES bind `agentId`
 *   server-side (from `context.agentId`, throwing if absent) before building
 *   `createReviewRuntimePrimitives` — but that binding is only the DEFAULT,
 *   not an enforced ceiling. Two independent, previously undocumented holes
 *   were found by tracing `createReviewRuntimePrimitives`
 *   (`apps/server/src/services/agentSignal/services/selfIteration/review/server.ts`),
 *   contradicting an earlier "scoped by `context.operationId`, fails closed"
 *   claim that was never actually traced for this identifier:
 *   1. Cross-agent read: `listManagedSkills` (`server.ts:568-572`) and
 *      `getManagedSkill` (`server.ts:556-567`) both destructure an optional
 *      `agentId` straight out of the model's own tool-call arguments and
 *      prefer it over the bound one — `skillDocumentService.listSkills({
 *      agentId: targetAgentId ?? agentId })`. `SkillManagementDocumentService`
 *      is constructed scoped only to `userId` (the creator), not to a single
 *      agent, so a share visitor can name any OTHER agentId belonging to the
 *      same creator and read that agent's private managed-skill catalog
 *      (name, description, full body via `includeContent: true`) — data that
 *      has nothing to do with the agent this share actually grants access to.
 *   2. Unconditional creator-scoped mutations: `writeMemory` (`server.ts:689-727`)
 *      always durably writes a memory via `runMemoryActionAgent` bound to the
 *      run's `agentId`; `createSkillIfAbsent` (`server.ts:525-555`) and
 *      `replaceSkillContentCAS` (`server.ts:612-672`) always create/overwrite a
 *      managed skill document via `SkillManagementDocumentService`. None of
 *      these are read-only, and `DATA_TOOL_ACCESS_RULES` has no entry for this
 *      identifier — v1 share grants are `none`/`read` only, so there is no
 *      grant that could legitimize any of the three even if the cross-agent
 *      read above were fixed. Removed from the allowlist entirely rather than
 *      narrowed: `AGENT_SIGNAL_REVIEW_TOOL_API_NAMES` is almost entirely
 *      mutations or proposal-lifecycle writes (`shared/apiNames.ts:12-52`),
 *      leaving no worthwhile read-only remainder to carve out.
 *
 * - `lobe-skill-maintainer` / `agent-signal-skill-management`: hidden,
 *   system-only tools (`hidden: true` in `packages/builtin-tools/src/index.ts`)
 *   whose `plugins: [...]` entries belong to the internal Agent Signal
 *   self-iteration agents (`@lobechat/builtin-agents`), not a creator's own
 *   conversational agent — under the current toolset-assembly path
 *   (`apps/server/src/services/aiAgent/index.ts`) neither identifier can reach
 *   a live share-visitor operation's `toolManifestMap`/`enabledToolIds` today.
 *   Their `agentId` IS genuinely context-scoped, not model-suppliable:
 *   `SkillMaintainerExecutionRuntime.resolveAgentId`
 *   (`packages/builtin-tool-skill-maintainer/src/ExecutionRuntime/index.ts:66-69`)
 *   reads only `context.agentId`, and the `{ ...args, agentId }` spread order
 *   (same file, e.g. line 93) overwrites any `agentId` a model tries to
 *   smuggle into `args`; `agentSignalSkillManagementRuntime`
 *   (`apps/server/src/services/toolExecution/serverRuntimes/agentSignalSkillManagement.ts:21-33`)
 *   likewise binds `agentId` from `context` at factory time. Absent here as
 *   defense in depth: every API on both tools (`createSkill` /
 *   `replaceSkillIndex` / `renameSkill` / `createSkillIfAbsent` /
 *   `replaceSkillContentCAS`) WRITES agent-document rows under the creator's
 *   account via `SkillManagementDocumentService`, and a v1 share's
 *   `filePermissionConfig` only ever grants `'read'` or `'none'` — there is
 *   no write grant to honor, so any accidental future path that lets a
 *   share-visitor operation pick up either plugin id must still resolve to
 *   "blocked."
 *
 * - `lobe-task` / `lobe-goal`: `lobe-task` executes in `createTaskRuntime`
 *   (`apps/server/src/services/toolExecution/serverRuntimes/task.ts`) against
 *   `TaskModel`/`taskRouter`, both scoped only by `userId`/`workspaceId` — the
 *   CREATOR's. Every mutating and single-task-read API takes a model-supplied
 *   `identifier` (`deleteTask` task.ts:373, `editTask` task.ts:413,
 *   `setTaskSchedule`/`setTaskVerify` task.ts:551,632, `runTask`/`runTasks`
 *   task.ts:704,747, `updateTaskStatus`/`viewTask` task.ts:786,839) or
 *   `commentId` resolved through `TaskModel.resolve` with NO topic/
 *   conversation check — `TaskModel.resolve`'s `ownership()` filter only
 *   checks `userId`/`workspaceId` (`packages/database/src/models/task.ts:326`).
 *   That lets a visitor read, edit, delete, comment on, reschedule,
 *   reconfigure, or RUN (spending the creator's budget) any task anywhere in
 *   the creator's workspace. `listTasks` (task.ts:521) makes the breadth
 *   explicit: `scope: 'allAgents'` deliberately returns every task across
 *   every agent in the workspace. There is no membership relation to scope a
 *   task to "only tasks from this visitor's topic" (`tasks.currentTopicId`/
 *   `task_topics` track execution runs, not creation), so the fail-closed fix
 *   is to block the whole identifier. `lobe-goal`'s `createGoal`
 *   (`serverRuntimes/index.ts`'s `goalRuntime`) is a thin wrapper that reuses
 *   `taskRuntime.factory(context).createGoal` directly — same
 *   creator/workspace-wide task tracker, same absence of topic scoping, so it
 *   is denied for the identical reason even though it exposes only one API.
 *
 * - `lobe-creds`: `injectCreds`
 *   (`serverRuntimes/creds.ts:97-125`, `ServerCredsService.injectCreds`) takes
 *   a free-form `keys: string[]` and decrypts the matching entries straight
 *   out of the creator's (or workspace's) ENTIRE saved credential store into
 *   the sandbox env — nothing ties `keys` to this agent/share. `listCreds`/
 *   `getByKey`/`saveKVCred` are the same whole-account credential surface.
 *
 * - `lobe-message`: every bot-management API on `MessageDispatcherService`'s
 *   `botProvider` (`serverRuntimes/message/index.ts`) resolves `botId`
 *   straight from model args with no check against `context.agentId`
 *   (`getBotDetail`/`updateBot`/`deleteBot`/`toggleBot`/`connectBot`, lines
 *   293-451) — an arbitrary bot integration credential on the creator's
 *   account. `listMessengers`/`getMessengerDetail`/`unlinkMessenger`/
 *   `setMessengerActiveAgent`/`sendMessengerPush` (lines 458-742) act on the
 *   creator's whole personal messenger account (every platform install, every
 *   linked IM account), not anything scoped to the shared agent.
 *
 * - `lobe-skill-store`: `importFromGitHub`/`importFromUrl`/`importFromZipUrl`/
 *   `importFromMarket` (`serverRuntimes/skillStore.ts:104-230`) fetch
 *   attacker-chosen remote code/zip content and persist it into the creator's
 *   (or workspace's) skill catalog via `SkillImporter` — arbitrary code
 *   supply into the creator's account, gated by nothing but the URL the model
 *   supplies.
 *
 * - `lobe-agent-builder`: `updateConfig`/`updatePrompt`
 *   (`serverRuntimes/agentBuilder.ts:169-282`) resolve `agentId` from
 *   `ctx.editingAgentId ?? ctx.agentId` and then overwrite that agent's
 *   `systemRole`/config wholesale — for the shared agent this IS the agent
 *   the visitor is chatting through, so this is a visitor rewriting the
 *   creator's live agent prompt/config. `installPlugin` (lines 284-377)
 *   installs an arbitrary market MCP plugin (or pins a builtin tool) onto
 *   that same agent as the creator, with no OAuth/consent step.
 *
 * - `lobe-skills`: `findById`/`findByName`
 *   (`serverRuntimes/skills.ts:154-162`) resolve any skill by id/name across
 *   the creator's ENTIRE personal `AgentSkillModel` catalog — scoped only by
 *   `disabledSkillIds` (an opt-out set), with no equivalent of the
 *   `shareAllowedSkillIds` allowlist that the separate `lobe-activator`
 *   runtime already applies to its own embedded skills runtime
 *   (`serverRuntimes/activator.ts:104-112` — which is why `lobe-activator`
 *   IS allowed above; the two tools reach the same underlying skill catalog
 *   through differently-guarded paths).
 *
 * - `lobe-group-agent-builder` / `lobe-group-management`: group-orchestration
 *   tools (member CRUD, dispatch) that operate on the creator's group-agent
 *   collection and membership, with no share-run scoping designed in — same
 *   risk class as `lobe-agent-management` (arbitrary creator-resource
 *   mutation via model-suppliable ids). `lobe-group-agent-builder`'s server
 *   runtime is owned by another in-flight change; this denial does not depend
 *   on or modify that file.
 *
 * Denied for lack of positive safety evidence (no confirmed exploit was
 * required to withhold access — the point of default-deny is that an unproven
 * tool does not ship, full stop):
 *
 * - `lobe-local-system` / `lobe-browser` / `lobe-remote-device`: these proxy
 *   through `deviceGateway` to the creator's own registered physical
 *   device(s) — shell commands (`local-system`), live browser control
 *   (`browser`), and device enumeration/attachment (`remote-device`,
 *   `serverRuntimes/remoteDevice.ts:29-58`). A share visitor executing
 *   arbitrary commands or driving a live browser session on the CREATOR's own
 *   computer/phone is a far larger blast radius than any single data store,
 *   and none of the three re-derive scope from the share.
 *
 * - `lobe-cloud-sandbox`: general-purpose shell/script execution
 *   (`serverRuntimes/cloudSandbox.ts`) authenticated as the creator, including
 *   `lh` CLI credential injection (`preprocessLhCommand`). Unlike the
 *   `lobe-skills` sandbox path (execScript/runCommand there are also denied
 *   via the `lobe-skills` block above), this is the standalone tool with no
 *   skill-catalog scoping at all — arbitrary creator-authenticated code
 *   execution.
 *
 * - `lobe-web-onboarding`: `readDocument`/`updateDocument`
 *   (`serverRuntimes/webOnboarding.ts`) read and WRITE the creator's own
 *   onboarding `SOUL.md` document and persona (`UserPersonaModel`) — a
 *   share-visitor write to the creator's personal onboarding profile, with no
 *   scoping to the shared agent at all.
 *
 * - `lobe-self-feedback-intent` / `agent-signal-reflection` /
 *   `agent-signal-feedback-intent`: hidden, system-only self-iteration tools
 *   for the internal background agents (`@lobechat/builtin-agents`), same
 *   population as `lobe-skill-maintainer` above. Their runtimes resolve
 *   `agentId` from context, not model args, and — like
 *   `agent-signal-review` (allowed above) — appear to fail closed without
 *   full operation/agent context. They are withheld anyway: unlike
 *   `agent-signal-review`, no completed audit pass verified their write paths
 *   (`SkillManagementDocumentService`-backed, same write surface flagged
 *   unsafe for `lobe-skill-maintainer`) as safe, so per the default-deny rule
 *   they stay out until that verification happens.
 *
 * SAFE / allowed — see the per-entry comments on `SHARE_VISITOR_ALLOWED_IDENTIFIERS`
 * above for `lobe-topic-reference`, `lobe-calculator`, `lobe-web-browsing`,
 * `lobe-user-interaction`, `lobe-activator`, `lobe-page-agent`, `lobe-brief`,
 * `lobe-image-generation`, `lobe-verify`, `lobe-acceptance-evidence`,
 * `lobe-agent`, `lobe-knowledge-base`, `lobe-user-memory`,
 * `lobe-agent-documents`.
 *
 * `agent-signal-review` is NOT on this list — see the "Confirmed leak paths"
 * entry above; it was removed after tracing `createReviewRuntimePrimitives`
 * found a cross-agent read plus unconditional creator-scoped mutations.
 */

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
 * here: the whole tool — dispatch included — is simply absent from
 * `SHARE_VISITOR_ALLOWED_IDENTIFIERS` above, so it never survives that gate.
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
