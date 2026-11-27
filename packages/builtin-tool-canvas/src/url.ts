/** Query param on a conversation URL that opens one Canvas in the working sidebar. */
export const CANVAS_OPEN_QUERY = 'canvas';

export interface BuildCanvasOpenUrlInput {
  agentId?: string | null;
  canvasId: string;
  topicId?: string | null;
  workspaceSlug?: string | null;
}

const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
};

/**
 * Build the in-app link that opens a Canvas inside its conversation. It needs a
 * signed-in user with access to that conversation; it is not a public link.
 * Returns `undefined` when the conversation cannot be addressed.
 */
export const buildCanvasOpenUrl = (
  origin: string | undefined,
  { agentId, canvasId, topicId, workspaceSlug }: BuildCanvasOpenUrlInput,
): string | undefined => {
  const base = origin ? trimTrailingSlashes(origin) : '';
  if (!base || !agentId || !topicId) return undefined;

  const workspacePrefix = workspaceSlug ? `/${encodeURIComponent(workspaceSlug)}` : '';
  const path = `/agent/${encodeURIComponent(agentId)}/${encodeURIComponent(topicId)}`;
  return `${base}${workspacePrefix}${path}?${CANVAS_OPEN_QUERY}=${encodeURIComponent(canvasId)}`;
};
