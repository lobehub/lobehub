import { standardizeIdentifier } from '@/utils/identifier';

/**
 * In-app router path for the standalone document view
 * (`/agent/:aid/docs/:docId`). The `:docId` segment carries the bare nanoid,
 * matching the route param (reconstructed via `getIdFromIdentifier`).
 *
 * @param agentId - Owning agent id, e.g. `agt_9GOn6nUgGw35`
 * @param documentId - The `documents` table id, e.g. `docs_MWkYMvbvzssoyWZ9`
 */
export const buildAgentDocumentPath = (agentId: string, documentId: string): string =>
  `/agent/${agentId}/docs/${standardizeIdentifier(documentId)}`;

/**
 * In-app router path for the agent documents index (`/agent/:aid/docs`) — the
 * no-document-selected landing that renders empty-state guidance in the center
 * while the right panel keeps showing the full document tree.
 *
 * @param agentId - Owning agent id, e.g. `agt_9GOn6nUgGw35`
 */
export const buildAgentDocumentsPath = (agentId: string): string => `/agent/${agentId}/docs`;
