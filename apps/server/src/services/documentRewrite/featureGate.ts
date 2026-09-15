/**
 * Operational kill switch for targeted collaborative rewrites.
 *
 * Disabling request creation must not disable room persistence or compatibility
 * settlement of a legacy Diff that already exists. Worker shutdown is a
 * separate operational action; this gate only protects the durable
 * request-creation boundary.
 */
export const DOCUMENT_REWRITE_FEATURE_FLAG = 'PAGE_AGENT_TARGETED_REWRITE_ENABLED';
export const DOCUMENT_REWRITE_DISABLED = 'DOCUMENT_REWRITE_DISABLED';

export interface DocumentRewriteFeatureFlagEnvironment {
  [key: string]: string | undefined;
  PAGE_AGENT_TARGETED_REWRITE_ENABLED?: string;
}

export const isDocumentRewriteCreationEnabled = (
  environment: DocumentRewriteFeatureFlagEnvironment = process.env,
): boolean => {
  const value = environment[DOCUMENT_REWRITE_FEATURE_FLAG];
  return value !== '0' && value !== 'false';
};

export const assertDocumentRewriteCreationEnabled = (
  environment: DocumentRewriteFeatureFlagEnvironment = process.env,
): void => {
  if (!isDocumentRewriteCreationEnabled(environment)) {
    throw new Error(DOCUMENT_REWRITE_DISABLED);
  }
};
