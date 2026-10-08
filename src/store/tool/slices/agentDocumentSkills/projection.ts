import { buildAgentSkillIdentifier } from '@lobechat/const';

import { defineReplica } from '@/libs/replica';
import type { agentDocumentService } from '@/services/agentDocument';

type AgentDocumentListResponse = Awaited<ReturnType<typeof agentDocumentService.listDocuments>>;
export type AgentDocumentListItem = AgentDocumentListResponse[number];

/**
 * Lightweight registry entry for an agent-document skill bundle (the "Agent Skills"
 * group, sourced from the `agent_document` table).
 *
 * Distinct from the user/market `SkillListItem` shape because these skills are
 * per-agent and don't carry a full `SkillManifest`. The slash menu, drag chip,
 * and runtime activation all key off `identifier` — the prefix lets the server
 * resolver tell them apart from builtin/DB skills.
 */
export interface AgentDocumentSkillItem {
  description?: string;
  documentId: string;
  /** `agent-skills:<filename>` — matches the server-side runtime identifier. */
  identifier: string;
  /** Bundle filename (slug). */
  name: string;
  /** Human-readable display title; falls back to `name`. */
  title?: string;
}

/**
 * Keep only the skill bundles and shape them into the registry entries the UI
 * keys off. The raw document list carries every agent document (including web
 * clips), so this is also the filter that keeps the registry to skills.
 */
export const mapDocsToSkills = (docs: AgentDocumentListItem[]): AgentDocumentSkillItem[] =>
  docs
    .filter((doc) => doc.isSkillBundle)
    .map((doc) => ({
      description: doc.description ?? undefined,
      documentId: doc.documentId,
      identifier: buildAgentSkillIdentifier(doc.filename),
      name: doc.filename,
      title: doc.title || undefined,
    }));

/**
 * One agent's skill bundles, keyed by `agentId` (`agentDocumentSkillsMap[agentId]`).
 *
 * Read-mostly: the registry is refreshed from `agentDocument` mutations (see
 * `invalidateDocumentMutation`), so the persisted copy paints the first frame
 * and the network only confirms. IndexedDB, not localStorage, because the list
 * is only read once a chat is open.
 */
export const agentDocumentSkillsResource = defineReplica<
  string,
  AgentDocumentSkillItem[],
  AgentDocumentListResponse
>({
  key: (agentId) => agentId,
  name: 'agentDocumentSkills',
  storage: 'indexedDB',
  version: 1,
});
