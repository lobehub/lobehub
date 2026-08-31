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
  builtinTools,
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
 * Server-side gate for shared-agent visitor conversations.
 *
 * Built exclusively by the shareChat router after the share access check —
 * never from client input. The gate is applied at operation-build time inside
 * `AiAgentService.execAgent`, so the restricted tool/memory/file surface is
 * snapshotted into the operation state and every later step inherits it
 * without the context engine knowing about shares.
 */
export interface AgentShareGate {
  agentId: string;
  shareConfig: AgentShareConfig;
  /**
   * The `agentShares.id` this run was authorized against — read together with
   * `shareConfig` in the SAME `AgentShareModel.findByShareIdWithAccessCheck`
   * call.
   *
   * This id IS the revocation token. There is no separate generation counter:
   * disabling a share hard-deletes the `agent_shares` row
   * (`AgentShareModel.deleteByAgentId`) and re-enabling it inserts a fresh one
   * with a brand-new UUID (`AgentShareModel.create`), so "the share row for
   * this agent still exists AND its id still equals `shareId` AND its
   * visibility is still `link`" is exactly the condition "this run's
   * authorization has not been revoked". Every re-validation in the visitor
   * chain (`shareVisitorAbuseGuards`, the per-step runtime re-check) is that
   * one comparison.
   */
  shareId: string;
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
 * Strip agent files / knowledge bases from a share visitor's resolved agent
 * config. Mutates in place — `agentConfig` is threaded through the whole
 * orchestration by reference (tool discovery, knowledge flags, context builder
 * snapshot), so a filtered copy would silently diverge.
 *
 * ADAPTATION vs the original design: the share config no longer carries a
 * `filePermissionConfig` field, so there is no grant a creator could set that
 * would expose their agent files or knowledge bases to a visitor. The gate is
 * therefore unconditional rather than conditional — the fail-closed reading of
 * "no configured permission". Re-introducing a file grant means restoring the
 * config field AND relaxing this function together.
 */
export const applyShareGateToAgentConfig = (agentConfig: {
  files?: unknown[] | null;
  knowledgeBases?: unknown[] | null;
}): void => {
  agentConfig.files = [];
  agentConfig.knowledgeBases = [];
};

/**
 * Minimal shape a `DataToolAccessRule.grant` needs — either the full share
 * gate's `shareConfig`, or the trimmed `agentShare` marker threaded through
 * `RuntimeExecutorContext` / `ToolExecutionContext` for tool calls resolved
 * outside this module (see {@link isShareBlockedDataToolCall}).
 */
export interface ShareDataToolPermissions {
  allowReadMemory?: boolean;
  /**
   * Agent's own persisted, `enabled` knowledge-base ids (never
   * visitor-supplied). Currently always empty for a share run — see
   * {@link applyShareGateToAgentConfig} — but kept so the id-scoping rule
   * below stays wired should a knowledge-base grant return.
   */
  knowledgeBaseIds?: string[];
}

/**
 * See `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS`'s JSDoc in
 * `@lobechat/builtin-tools` for the full per-identifier evidence. Aliased here
 * so the two enforcement points below read as one local rule.
 */
const SHARE_VISITOR_ALLOWED_IDENTIFIERS = AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS;

/**
 * Whether `identifier` belongs to the population this allowlist governs — the
 * real builtin tool registry (`@lobechat/builtin-tools`), the same source
 * `BuiltinToolsExecutor`/`hasServerRuntime` resolve against. MCP servers,
 * market plugins, and custom plugins never appear in this registry, so they
 * fall outside this allowlist's jurisdiction entirely and are left to
 * {@link filterPluginsByShareGate} / `shareConfig.enabledToolIds` — the
 * pre-existing (and unaffected) gate for that population.
 */
const isGovernedByBuiltinAllowlist = isBuiltinToolIdentifier;

type DataToolGrant = 'none' | 'read';

/**
 * Read/write surface of a builtin tool whose APIs act directly on the
 * creator's private data store (memory, knowledge bases, agent documents).
 *
 * These tools are gated by three independent axes: whether the share grants
 * ANY access at all (`grant`) — share grants are `none` | `read` only, there
 * is no write grant to honor; whether a given API is a write regardless of
 * grant (`writeApiNames`); and whether a "read" API can even be scoped to what
 * the share actually grants at all (`alwaysBlockedApiNames`,
 * `isArgsOutOfScope`) — some reads act on the caller's ENTIRE personal data
 * store with no id parameter tying them to the agent's own assignment, so a
 * `read` grant must not enable them.
 */
interface DataToolAccessRule {
  /**
   * API names that read across the creator's whole personal store
   * (independent of what this specific agent is assigned) with no id argument
   * that could scope the call. Always blocked for a share visitor, even when
   * `grant` is `read` — unlike `writeApiNames`, these ARE reads, but a read
   * grant only ever means "read what this agent is assigned," never "read
   * everything the creator owns."
   */
  alwaysBlockedApiNames?: string[];
  /** Resolve this share's grant for the tool from its permission fields. */
  grant: (permissions: ShareDataToolPermissions) => DataToolGrant;
  /**
   * For an API that DOES take an id scoping it to a specific resource (e.g.
   * `viewKnowledgeBase`'s `id`): whether the id(s) `args` references fall
   * outside what this share's permissions actually allow. Must fail closed —
   * an id that cannot be verified (missing, wrong type, or the allowlist
   * itself is empty/absent) is out of scope.
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
 * tool id enabled for the share" — it says nothing about `allowReadMemory`,
 * which is why a whitelisted memory/knowledge-base/agent-documents tool would
 * otherwise execute read-write under the creator's own permissions no matter
 * what the share granted.
 *
 * Adding a new write API to one of these packages must add it here too —
 * `shareGate.test.ts` asserts against the REAL exported manifests, so a rename
 * or omission fails that test instead of silently reopening the hole.
 */
const DATA_TOOL_ACCESS_RULES: Record<string, DataToolAccessRule> = {
  [AgentDocumentsIdentifier]: {
    // No file grant exists in the current `AgentShareConfig` — see
    // `applyShareGateToAgentConfig`'s adaptation note. Fail closed rather than
    // silently defaulting the missing grant to `read`.
    grant: () => 'none',
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
    // this agent is assigned." `listKnowledgeBases` lists every knowledge base
    // the creator owns, not just the ones mounted on this agent, and takes no
    // id to scope it either. `readKnowledge` accepts arbitrary
    // `file_*`/`docs_*` ids read straight from the creator's file/document
    // store with no knowledge-base-membership check of its own. Blocking them
    // is the fail-closed choice: `searchKnowledgeBase` (already agent/task-id
    // scoped server-side) still returns real chunk/document text, so a `read`
    // grant would remain useful without this hole.
    alwaysBlockedApiNames: [
      KnowledgeBaseApiName.listFiles,
      KnowledgeBaseApiName.getFileDetail,
      KnowledgeBaseApiName.listKnowledgeBases,
      KnowledgeBaseApiName.readKnowledge,
    ],
    // Same adaptation as `AgentDocumentsIdentifier` above: no knowledge-base
    // grant exists in the current `AgentShareConfig`.
    grant: () => 'none',
    // `viewKnowledgeBase` DOES take an `id`, and the agent's own assignment
    // would be known (`ShareDataToolPermissions.knowledgeBaseIds`) — kept
    // wired so restoring a knowledge-base grant only needs the `grant` line
    // above changed, not this scoping rule re-derived.
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
 * `runtime[apiName](...)` directly and never re-consults the possibly
 * already-trimmed manifest — the trimmed manifest only changes what the model
 * is OFFERED via function-calling schema, not what the executor is willing to
 * run if the model calls it anyway).
 *
 * DEFAULT-DENY for the builtin population: an `identifier` that resolves
 * against the real `@lobechat/builtin-tools` registry
 * (`isGovernedByBuiltinAllowlist`) but is NOT in
 * `SHARE_VISITOR_ALLOWED_IDENTIFIERS` is blocked outright, with no
 * `apiName`-level distinction. A non-builtin identifier (MCP server, market
 * plugin, custom plugin) is NOT this function's concern at all — it falls
 * through to `false` untouched, left entirely to
 * {@link filterPluginsByShareGate} / `shareConfig.enabledToolIds`.
 *
 * `args` is the tool call's parsed arguments, needed only for
 * `isArgsOutOfScope` rules. Omit it for call sites that only need the
 * identifier/apiName-level check (grant / write / always-blocked).
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
  // written — the whole point of inverting a denylist.
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
 * FULL dispatch-time gate for a share-visitor builtin tool call — the check
 * `BuiltinToolsExecutor.execute` runs on every call that reaches it. Strictly
 * wider than {@link isShareBlockedDataToolCall}: a call that bypassed
 * assembly (resume path, recovery hint, model-fabricated call to a tool it
 * was never offered) must clear ALL the same gates the assembled tool set
 * enforced, not only the data-tool rules:
 *
 * 1. master default-deny allowlist (`SHARE_VISITOR_ALLOWED_IDENTIFIERS`);
 * 2. the owner's own `enabledToolIds` picker — being on the master allowlist
 *    is necessary but NOT sufficient; a tool the creator never enabled for
 *    this share (e.g. `lobe-topic-reference`, image generation spending the
 *    creator's quota) must not run just because a call reached the executor;
 * 3. `humanIntervention` policy, re-derived from the REAL manifest: the
 *    assembly strip removes intervention-gated APIs from the manifest the
 *    runtime later consults, so at dispatch time such a call looks
 *    config-less and `headless` would silently auto-run it — the manifest in
 *    `@lobechat/builtin-tools` is the unstripped source of truth, so the
 *    consent-gated call is blocked here instead;
 * 4. the per-API data-tool rules ({@link isShareBlockedDataToolCall}).
 *
 * Non-builtin identifiers (MCP/market/custom plugins, LobeHub skills) pass
 * through untouched: their id namespace does not reliably match
 * `enabledToolIds` entries, so they remain governed by the assembly-time
 * `filterPluginsByShareGate` intersection only.
 */
export const isShareBlockedBuiltinDispatch = (
  agentShare: ShareDataToolPermissions & { enabledToolIds?: string[] },
  identifier: string,
  apiName: string,
  args?: any,
): boolean => {
  if (!isGovernedByBuiltinAllowlist(identifier)) return false;

  if (!SHARE_VISITOR_ALLOWED_IDENTIFIERS.has(identifier)) return true;
  if (!(agentShare.enabledToolIds ?? []).includes(identifier)) return true;

  const manifest = builtinTools.find((tool) => tool.identifier === identifier)?.manifest;
  const toolLevelHumanIntervention = (manifest as { humanIntervention?: unknown } | undefined)
    ?.humanIntervention;
  const apiHumanIntervention = manifest?.api?.find(
    (api) => api.name === apiName,
  )?.humanIntervention;
  if (!isApiUsableForShareVisitor(apiHumanIntervention ?? toolLevelHumanIntervention)) return true;

  return isShareBlockedDataToolCall(agentShare, identifier, apiName, args);
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
 * Apply {@link DATA_TOOL_ACCESS_RULES} to the assembled tool set: drop a data
 * tool entirely when its grant is `none`, or strip its write APIs (from both
 * the manifest and the function-calling `tools` schema) when the grant is
 * `read`. Runs as part of {@link applyShareGateToToolSet} — after that pass's
 * allowlist intersection has already decided which identifiers survive at all
 * — so this only needs to further restrict, never re-add.
 *
 * This is UX/defense-in-depth (the model is never offered the disallowed
 * function); the actual unbypassable enforcement is
 * {@link isShareBlockedDataToolCall} at the `BuiltinToolsExecutor` dispatch
 * site.
 */
const applyShareGateToDataToolAccess = (toolSet: ShareGateToolSet, gate: AgentShareGate): void => {
  for (const [identifier, rule] of Object.entries(DATA_TOOL_ACCESS_RULES)) {
    if (!toolSet.manifestMap[identifier]) continue;

    const grant = rule.grant(gate.shareConfig);

    if (grant === 'none') {
      dropToolFromSet(toolSet, identifier);
      continue;
    }

    // Under a `read` grant, strip both mutations (`writeApiNames`) AND the
    // creator-wide reads that no grant can honestly scope to this agent
    // (`alwaysBlockedApiNames`) — same treatment, since both are never offered
    // to the model regardless of grant. `isArgsOutOfScope`-covered APIs are
    // NOT stripped here: they stay offered because they CAN be in scope
    // depending on the id the model picks, and that per-call id check only
    // runs at dispatch time, not against a static manifest.
    const blockedApiNames = new Set([...rule.writeApiNames, ...(rule.alwaysBlockedApiNames ?? [])]);

    stripApisFromTool(toolSet, identifier, blockedApiNames);
  }
};

/**
 * Final allowlist enforcement for a share visitor's fully-assembled tool set.
 *
 * `shareConfig.enabledToolIds` is the single source of truth for what a share
 * visitor can see or run. This pass mutates `toolSet` in place and must run
 * once, after every manifest/default/dynamic-activation source has been merged
 * in, immediately before the operation's `toolSet` is persisted. An
 * empty/missing whitelist collapses the set to nothing (no built-in tool is
 * exempted; a share with no configured tools is a plain-chat run).
 */
export const applyShareGateToToolSet = (toolSet: ShareGateToolSet, gate: AgentShareGate): void => {
  const ownerAllowed = new Set(gate.shareConfig.enabledToolIds ?? []);

  // A tool must clear BOTH gates: the owner's own `enabledToolIds` picker
  // (`ownerAllowed`), AND — for builtin identifiers only — the default-deny
  // master allowlist (`SHARE_VISITOR_ALLOWED_IDENTIFIERS`). Non-builtin
  // identifiers (MCP/market/custom plugins) are outside
  // `isGovernedByBuiltinAllowlist`'s population, so they pass straight through
  // to the owner-picker check unaffected — this allowlist must never decide
  // their fate, in either direction.
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
  applyShareGateToInterventionRequiredApis(toolSet);
};

/**
 * Whether an API's own `humanIntervention` policy can ever HONESTLY complete
 * for a share-visitor run. Every share run is forced onto `approvalMode:
 * 'headless'` (see `AiAgentService.execAgent`'s unconditional override) — the
 * only mode with **no approver waited for**: an `'always'`-policy call becomes
 * an immediate blocked tool result (`resolve_blocked_tools`), and a
 * `'required'`-policy call would silently auto-run, granting itself the
 * consent nobody was present to give. Stripping both classes from the offer
 * is therefore the fail-closed reading: never offer a function that either
 * cannot run or would run without its declared consent step. A `dynamic`
 * config might resolve to `'never'` for some argument, but this static,
 * schema-assembly-time check cannot prove it always will.
 *
 * `undefined` (no config at all) and the literal string `'never'` are the only
 * two configs that execute with no intervention semantics attached.
 */
const isApiUsableForShareVisitor = (humanIntervention: unknown): boolean =>
  humanIntervention === undefined || humanIntervention === 'never';

/**
 * Structural counterpart to `applyShareGateToDataToolAccess`: strip any builtin
 * API whose OWN `humanIntervention` policy cannot honestly complete under a
 * share visitor's forced `headless` approval mode. Reads the SAME `humanIntervention`
 * metadata every builtin tool already declares for the approval-UI feature, so
 * a future tool added to `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS` with an
 * intervention-gated API is caught automatically instead of requiring a manual
 * audit.
 *
 * Scoped to builtin identifiers only (`isGovernedByBuiltinAllowlist`) — MCP /
 * market / custom plugin manifests are not `BuiltinToolManifest`s and don't
 * carry this field's tool-level fallback the same way; they are governed
 * exclusively by {@link filterPluginsByShareGate}.
 *
 * A tool whose TOOL-LEVEL `humanIntervention` (the fallback every API without
 * its own entry inherits) is itself unusable loses every API and is dropped
 * entirely, the same treatment `applyShareGateToDataToolAccess` gives a
 * `'none'` grant.
 *
 * Under `headless` this strip is MORE than UX for `'required'`-policy APIs:
 * headless auto-runs those, so removing them from the offer is the layer that
 * keeps a share visitor's model from invoking a consent-gated API without its
 * consent step ever happening. `'always'`-policy APIs stay unreachable either
 * way (headless converts them to blocked results); data-bearing APIs are
 * additionally re-blocked at dispatch by {@link isShareBlockedDataToolCall}.
 */
const applyShareGateToInterventionRequiredApis = (toolSet: ShareGateToolSet): void => {
  for (const identifier of Object.keys(toolSet.manifestMap)) {
    if (!isGovernedByBuiltinAllowlist(identifier)) continue;

    const manifest = toolSet.manifestMap[identifier];
    if (!Array.isArray(manifest.api) || manifest.api.length === 0) continue;

    const toolLevelHumanIntervention = (manifest as { humanIntervention?: unknown })
      .humanIntervention;

    if (!isApiUsableForShareVisitor(toolLevelHumanIntervention)) {
      dropToolFromSet(toolSet, identifier);
      continue;
    }

    const blockedApiNames = new Set(
      manifest.api
        .filter((api) => !isApiUsableForShareVisitor(api.humanIntervention))
        .map((api) => api.name),
    );
    if (blockedApiNames.size === 0) continue;

    stripApisFromTool(toolSet, identifier, blockedApiNames);
  }
};

/**
 * Rationale for every registered builtin identifier that is DENIED — i.e.
 * absent from `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS`. Under a denylist an
 * identifier had to be explicitly proven dangerous to be blocked; under the
 * allowlist an identifier has to be explicitly proven safe to be exposed, so
 * this block exists purely to record the evidence trail for reviewers — the
 * denial itself needs no code beyond "not in the Set".
 *
 * Confirmed leak paths (a concrete visitor→creator-data route was found):
 *
 * - `lobe-agent-management`: `agentManagementRuntime` is scoped by `userId`
 *   (the creator — the run executes as the creator), but `agentId` is a
 *   free-form model argument on nearly every API. `searchAgent` enumerates the
 *   creator's whole workspace; `getAgentDetail` returns any creator-owned
 *   agent's full config (system prompt included) for an arbitrary id;
 *   `createAgent` / `updateAgent` / `updatePrompt` / `duplicateAgent` /
 *   `installPlugin` persistently mutate the creator's agent collection.
 *
 * - `agent-signal-review`: `listManagedSkills` / `getManagedSkill` prefer an
 *   optional model-supplied `agentId` over the context-bound one, letting a
 *   visitor read ANY other agent's private managed-skill catalog under the
 *   same creator. `writeMemory` / `createSkillIfAbsent` /
 *   `replaceSkillContentCAS` are unconditional creator-scoped mutations, and
 *   share grants are `none`/`read` only.
 *
 * - `lobe-skill-maintainer` / `agent-signal-skill-management`: hidden,
 *   system-only tools whose every API WRITES agent-document rows under the
 *   creator's account. No write grant exists to honor.
 *
 * - `lobe-task` / `lobe-goal`: `TaskModel`/`taskRouter` are scoped only by
 *   `userId`/`workspaceId` — the CREATOR's. Every mutating and single-task-read
 *   API takes a model-supplied identifier resolved with no topic/conversation
 *   check, letting a visitor read, edit, delete, reschedule or RUN (spending
 *   the creator's budget) any task in the workspace. `listTasks`'s `scope:
 *   'allAgents'` makes the breadth explicit.
 *
 * - `lobe-creds`: `injectCreds` takes a free-form `keys: string[]` and decrypts
 *   matching entries out of the creator's ENTIRE saved credential store.
 *
 * - `lobe-message`: every bot-management API resolves `botId` straight from
 *   model args with no check against `context.agentId`; the messenger APIs act
 *   on the creator's whole personal messenger account.
 *
 * - `lobe-skill-store`: the `importFrom*` family fetches attacker-chosen
 *   remote code/zip content and persists it into the creator's skill catalog.
 *
 * - `lobe-agent-builder`: `updateConfig`/`updatePrompt` overwrite the shared
 *   agent's own `systemRole`/config wholesale — a visitor rewriting the
 *   creator's live agent. `installPlugin` installs an arbitrary market MCP
 *   plugin onto it as the creator, with no consent step.
 *
 * - `lobe-skills`: `findById`/`findByName` resolve any skill across the
 *   creator's ENTIRE personal skill catalog, scoped only by an opt-out
 *   `disabledSkillIds` set.
 *
 * - `lobe-brief`: `createBrief` unconditionally persists a row via
 *   `BriefModel.create` under `context.userId` (the creator) from
 *   model-supplied content, with no intervention marker to gate it.
 *
 * - `lobe-group-agent-builder` / `lobe-group-management`: group-orchestration
 *   tools operating on the creator's group-agent collection and membership,
 *   with no share-run scoping designed in — same risk class as
 *   `lobe-agent-management`.
 *
 * Denied for lack of positive safety evidence (no confirmed exploit was
 * required to withhold access — the point of default-deny is that an unproven
 * tool does not ship):
 *
 * - `lobe-local-system` / `lobe-browser` / `lobe-remote-device`: these proxy
 *   through `deviceGateway` to the creator's own registered physical
 *   device(s). A visitor executing arbitrary commands or driving a live
 *   browser session on the CREATOR's own machine is a far larger blast radius
 *   than any single data store.
 *
 * - `lobe-cloud-sandbox`: general-purpose shell/script execution
 *   authenticated as the creator, including `lh` CLI credential injection.
 *
 * - `lobe-web-onboarding`: reads and WRITES the creator's own onboarding
 *   `SOUL.md` document and persona.
 *
 * - `lobe-self-feedback-intent` / `agent-signal-reflection` /
 *   `agent-signal-feedback-intent`: hidden, system-only self-iteration tools
 *   whose write paths were never audited for share safety.
 *
 * - `lobe-page-agent`: not unsafe — genuinely unreachable for a share
 *   visitor's run (`execAgent` strips it whenever `appContext?.scope !==
 *   'page'`, and the share visitor path never sets `scope`), so allowlisting
 *   it would only let the owner-facing tool picker confirm a grant no visitor
 *   conversation can ever exercise.
 *
 * - `lobe-user-interaction` / `lobe-activator`: same "picker promises an
 *   unusable grant" class, not a data leak. Every share run is forced onto
 *   `approvalMode: 'headless'` with no approver ever present:
 *   `lobe-user-interaction`'s only entry point (`askUserQuestion`,
 *   `humanIntervention: 'always'`) is converted to a blocked tool result and
 *   never runs, and its other APIs all require a `requestId` only a
 *   successful `askUserQuestion` mints. `lobe-activator`'s only API
 *   (`activateTools`, `humanIntervention: 'required'`) would auto-run under
 *   headless but is stripped from the offer instead. See
 *   {@link applyShareGateToInterventionRequiredApis} for the structural fix
 *   that catches this failure mode generically on every ALLOWED tool's
 *   individual APIs.
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
 * `SHARE_VISITOR_ALLOWED_IDENTIFIERS`, so it never survives that gate.
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
      // carries the dispatch entry — an already context-aware-trimmed manifest
      // (api filtered upstream) could otherwise keep a stale `systemRole` that
      // still instructs the model to call the removed tool.
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

/** Remove one tool identifier from every parallel structure of the tool set. */
const dropToolFromSet = (toolSet: ShareGateToolSet, identifier: string): void => {
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
};

/** Drop `blockedApiNames` from one tool's manifest AND its function-calling schema. */
const stripApisFromTool = (
  toolSet: ShareGateToolSet,
  identifier: string,
  blockedApiNames: Set<string>,
): void => {
  const manifest = toolSet.manifestMap[identifier];
  if (!manifest) return;

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
};

const pruneArrayInPlace = <T>(array: T[], keep: (item: T) => boolean): void => {
  for (let i = array.length - 1; i >= 0; i -= 1) {
    if (!keep(array[i])) array.splice(i, 1);
  }
};
