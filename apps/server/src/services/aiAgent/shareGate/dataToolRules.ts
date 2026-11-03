import {
  AGENT_SHARE_DOCUMENT_API_NAMES,
  AgentDocumentsApiName,
  AgentDocumentsIdentifier,
} from '@lobechat/builtin-tool-agent-documents';
import {
  KnowledgeBaseApiName,
  KnowledgeBaseIdentifier,
} from '@lobechat/builtin-tool-knowledge-base';
import { MEMORY_WRITE_API_NAMES, MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import {
  AGENT_SHARE_SKILL_API_NAMES,
  SkillsIdentifier,
  SkillsManifest,
} from '@lobechat/builtin-tool-skills';
import { hasShareToolGrant, resolveShareToolGrants } from '@lobechat/const';

import { hasShareSkillAuthorization } from './grants';
import type { ShareDataToolPermissions } from './types';

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
 * into (`shareConfig.toolGrants`) without the whitelist itself implying
 * read OR write access to the underlying store. `filterPluginsByShareGate` /
 * `applyShareGateToToolSet`'s allowlist intersection only answers "is this
 * tool id enabled for the share" — it says nothing about `allowReadMemory`,
 * which is why a whitelisted memory/knowledge-base/agent-documents tool would
 * otherwise execute read-write under the creator's own permissions no matter
 * what the share granted.
 *
 * Adding a new write API to one of these packages must add it here too —
 * `dispatch.test.ts` asserts against the REAL exported manifests, so a rename
 * or omission fails that test instead of silently reopening the hole.
 */
export const DATA_TOOL_ACCESS_RULES: Record<string, DataToolAccessRule> = {
  [AgentDocumentsIdentifier]: {
    // The tool grant opts into a separately scoped authoring store. It never
    // exposes the creator's ordinary Agent Documents: the runtime and database
    // both constrain reads and writes to (shareId, visitorUserId, topicId).
    grant: (permissions) =>
      hasShareToolGrant(resolveShareToolGrants(permissions.toolGrants), AgentDocumentsIdentifier)
        ? 'read'
        : 'none',
    writeApiNames: Object.values(AgentDocumentsApiName).filter(
      (apiName) => !AGENT_SHARE_DOCUMENT_API_NAMES.has(apiName),
    ),
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
    // Shared with the share settings picker so the owner is never offered a
    // write API the gate strips anyway.
    writeApiNames: [...MEMORY_WRITE_API_NAMES],
  },
  [SkillsIdentifier]: {
    // The grant is the creator's skill list, not a tool-picker entry — see
    // `hasShareSkillAuthorization`. `'read'` is the widest a share can reach:
    // the two surviving APIs only read skill content, and WHICH skills they may
    // read is enforced separately (`filterSkillsByShareGate` at assembly, the
    // skill runtime's own check at load time — the latter is the real gate,
    // since `activateSkill` resolves a model-supplied name).
    grant: (permissions) => (hasShareSkillAuthorization(permissions) ? 'read' : 'none'),
    // Derived as "everything outside the visitor-safe set" rather than listed,
    // so a skill API added later is denied by default. Today that resolves to
    // `runCommand` / `execScript` / `exportFile`. Share runs now honor the
    // visitor's approval flow, so `humanIntervention: 'required'` no longer
    // strips the first two — this list is what keeps them closed until
    // opening skill script execution to visitors is decided on its own
    writeApiNames: SkillsManifest.api
      .map((api) => api.name)
      .filter((apiName) => !AGENT_SHARE_SKILL_API_NAMES.has(apiName)),
  },
};
