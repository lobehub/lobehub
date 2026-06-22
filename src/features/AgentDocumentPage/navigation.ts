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
