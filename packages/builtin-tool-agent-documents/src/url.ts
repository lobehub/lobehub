/**
 * Strip the `docs_` (or any `<prefix>_`) prefix from a documents-table id.
 * Mirrors the SPA `standardizeIdentifier` convention used by the
 * `/agent/:agentId/docs/:docId` route param, which carries the bare nanoid.
 */
const stripDocumentPrefix = (documentId: string): string =>
  documentId.includes('_') ? documentId.split('_')[1] : documentId;

const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
};

export interface BuildAgentDocumentUrlOptions {
  workspaceSlug?: string | null;
}

/**
 * Build a shareable URL that opens an agent document in the standalone
 * document route (`/:workspaceSlug?/agent/:agentId/docs/:docId`). Returns
 * `undefined` when no origin is available so callers can fall back to the bare
 * id.
 *
 * @param origin - App origin, e.g. `https://app.lobehub.com` (no trailing slash required)
 * @param agentId - Owning agent id, e.g. `agt_9GOn6nUgGw35`
 * @param documentId - The `documents` table id, e.g. `docs_MWkYMvbvzssoyWZ9`
 */
export const buildAgentDocumentUrl = (
  origin: string | undefined,
  agentId: string,
  documentId: string,
  options?: BuildAgentDocumentUrlOptions,
): string | undefined => {
  if (!origin) return undefined;
  const base = trimTrailingSlashes(origin);
  if (!base) return undefined;

  const workspacePrefix = options?.workspaceSlug ? `/${options.workspaceSlug}` : '';
  return `${base}${workspacePrefix}/agent/${agentId}/docs/${stripDocumentPrefix(documentId)}`;
};
