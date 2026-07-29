export interface AgentDocumentWriteResultParams {
  /**
   * The `agentDocuments` association row id. It is the handle the agent uses for
   * subsequent read/edit/remove calls — it is NOT actionable for the end user,
   * so it must never be surfaced to them when a shareable url exists.
   */
  id: string;
  /** Document title, used as the human-facing label. */
  title?: string;
  /**
   * Shareable url that opens the document. When present, the agent is told to
   * relay it as a clickable markdown link; otherwise the id is the only handle.
   */
  url?: string;
}

const titleLabel = (title?: string): string => (title ? `"${title}"` : 'the document');

/**
 * Render a write-class tool result with a consistent link/id policy.
 *
 * `lead` is the action clause without trailing punctuation, e.g.
 * `Created document "Daily Brief"`. When a url is present the agent must hand
 * the user a clickable link and keep the internal id to itself; when it is
 * absent (no url builder configured) the id is the only handle, so it is shown.
 */
const formatWriteResult = (lead: string, { id, url }: { id: string; url?: string }): string =>
  url
    ? `${lead}. Share this link with the user as a clickable markdown link: ${url}. ` +
      `(Internal id ${id} — for your own further edit/read/remove calls only; never show it to the user.)`
    : `${lead} (internal id: ${id}).`;

export const formatCreateDocumentResult = ({
  id,
  title,
  url,
}: AgentDocumentWriteResultParams): string =>
  formatWriteResult(`Created document ${titleLabel(title)}`, { id, url });

export const formatReplaceDocumentResult = ({
  id,
  title,
  url,
}: AgentDocumentWriteResultParams): string =>
  formatWriteResult(`Updated document ${titleLabel(title)}`, { id, url });

export interface FormatModifyDocumentResultParams extends AgentDocumentWriteResultParams {
  operationCount: number;
}

export const formatModifyDocumentResult = ({
  id,
  title,
  url,
  operationCount,
}: FormatModifyDocumentResultParams): string =>
  formatWriteResult(
    `Modified document ${titleLabel(title)}, applied ${operationCount} operation(s)`,
    { id, url },
  );

export const formatRenameDocumentResult = ({
  id,
  title,
  url,
}: AgentDocumentWriteResultParams): string =>
  formatWriteResult(`Renamed document to ${titleLabel(title)}`, { id, url });

export interface FormatCopyDocumentResultParams extends AgentDocumentWriteResultParams {
  /** The source document's id that was copied from. */
  fromId: string;
}

export const formatCopyDocumentResult = ({
  id,
  title,
  url,
  fromId,
}: FormatCopyDocumentResultParams): string =>
  formatWriteResult(`Copied document ${fromId} to a new document ${titleLabel(title)}`, {
    id,
    url,
  });

export const formatUpdateLoadRuleResult = ({
  id,
  title,
  url,
}: AgentDocumentWriteResultParams): string =>
  formatWriteResult(`Updated load rule for document ${titleLabel(title)}`, { id, url });

/** A removed document has no live url to share, so only the id is reported. */
export const formatRemoveDocumentResult = ({ id }: { id: string }): string =>
  `Removed document ${id}.`;
