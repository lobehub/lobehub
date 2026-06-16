/**
 * Strip the `docs_` (or any `<prefix>_`) prefix from a documents-table id.
 * Mirrors the SPA `standardizeIdentifier` convention used by the
 * `/agent/:agentId/docs/:docId` route param, which carries the bare nanoid.
 */
const stripDocumentPrefix = (documentId: string): string =>
  documentId.includes('_') ? documentId.split('_')[1] : documentId;

/**
 * Build a shareable URL that opens an agent document in the standalone
 * document route (`/agent/:agentId/docs/:docId`). Returns `undefined` when no
 * origin is available so callers can fall back to the bare id.
 *
 * @param origin - App origin, e.g. `https://app.lobehub.com` (no trailing slash required)
 * @param agentId - Owning agent id, e.g. `agt_9GOn6nUgGw35`
 * @param documentId - The `documents` table id, e.g. `docs_MWkYMvbvzssoyWZ9`
 */
export const buildAgentDocumentUrl = (
  origin: string | undefined,
  agentId: string,
  documentId: string,
): string | undefined => {
  if (!origin) return undefined;
  const base = origin.replace(/\/+$/, '');
  return `${base}/agent/${agentId}/docs/${stripDocumentPrefix(documentId)}`;
};
