import {
  AGENT_DOCUMENT_INJECTION_POSITIONS,
  type AgentContextDocument,
  type AgentDocumentInjectionPosition,
} from '@lobechat/context-engine';

import type { AgentDocumentWithRules } from '@/database/models/agentDocuments';

const VALID_DOCUMENT_POSITIONS = new Set<AgentDocumentInjectionPosition>(
  AGENT_DOCUMENT_INJECTION_POSITIONS,
);

export const normalizeAgentDocumentPosition = (
  position: string | null | undefined,
): AgentDocumentInjectionPosition | undefined => {
  if (!position) return undefined;

  return VALID_DOCUMENT_POSITIONS.has(position as AgentDocumentInjectionPosition)
    ? (position as AgentDocumentInjectionPosition)
    : undefined;
};

/**
 * Map a database `AgentDocumentWithRules` row into the `AgentContextDocument`
 * shape consumed by the context-engine providers.
 *
 * Lives in the app layer (not in `@lobechat/database` nor `@lobechat/context-engine`)
 * because it bridges two independent packages — adding a field here propagates
 * to every caller (client SWR fetch, server agent runtime) at once. Two
 * hand-rolled copies of this map previously diverged when `sourceType` was
 * added on the client only, which broke the "hide web crawls from the
 * progressive index" filter on every server-driven chat (LOBE-9383).
 */
export const toAgentContextDocument = (doc: AgentDocumentWithRules): AgentContextDocument => ({
  content: doc.content,
  description: doc.description ?? undefined,
  filename: doc.filename,
  id: doc.id,
  loadPosition: normalizeAgentDocumentPosition(
    doc.policy?.context?.position || doc.policyLoadPosition,
  ),
  loadRules: doc.loadRules,
  policyId: doc.templateId,
  policyLoad: doc.policyLoad,
  policyLoadFormat: doc.policy?.context?.policyLoadFormat || doc.policyLoadFormat || undefined,
  sourceType: doc.sourceType ?? undefined,
  title: doc.title,
  updatedAt: doc.updatedAt ?? undefined,
});

export const toAgentContextDocuments = (docs: AgentDocumentWithRules[]): AgentContextDocument[] =>
  docs.map((doc) => toAgentContextDocument(doc));
