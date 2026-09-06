/** Drop empty key/value pairs a user may have left behind in an editor. */
export const cleanRecord = (
  record?: Record<string, string>,
): Record<string, string> | undefined => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const cleaned = Object.fromEntries(
    Object.entries(record).filter(([k, v]) => k.trim() && (v ?? '').trim()),
  );
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

/**
 * Build the connector `metadata` jsonb payload from the DevModal form state.
 *
 * Description, avatar and custom headers all persist in the metadata column —
 * the encrypted `credentials` column only holds the single auth credential
 * (#16070: earlier save paths only wrote `customHeaders`, silently dropping
 * description and avatar on both create and edit).
 *
 * A jsonb update replaces the whole column, so edit mode must pass `existing`
 * to carry over sibling keys the form does not own (e.g. composio identity,
 * `mountedByAgentId`). Form-owned keys are re-derived from the form on every
 * save: a cleared field deletes its key.
 */
export const buildCustomConnectorMetadata = (
  form: { avatar?: string; description?: string; headers?: Record<string, string> },
  existing?: Record<string, unknown> | null,
): Record<string, unknown> => {
  const metadata: Record<string, unknown> = { ...existing };

  const description = form.description?.trim();
  if (description) metadata.description = description;
  else delete metadata.description;

  const avatar = form.avatar?.trim();
  if (avatar) metadata.avatar = avatar;
  else delete metadata.avatar;

  const headers = cleanRecord(form.headers);
  if (headers) metadata.customHeaders = headers;
  else delete metadata.customHeaders;

  return metadata;
};
