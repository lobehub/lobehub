import type { PageRewriteRequest } from './rewriteRequests';

/** Durable error codes own presentation; progress and topic metadata can lag. */
export const getRewriteFailureKey = (errorCode?: string | null) => {
  if (errorCode === 'DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR:empty')
    return 'copilot.rewrite.failure.empty';
  if (errorCode === 'DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR:truncated')
    return 'copilot.rewrite.failure.truncated';
  if (errorCode === 'DOCUMENT_REWRITE_PRODUCTION_CONFIG_ERROR')
    return 'copilot.rewrite.failure.config';
  if (errorCode?.startsWith('DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR'))
    return 'copilot.rewrite.failure.generation';
  return 'copilot.rewrite.failure.generic';
};

export const canRetryRewriteFailure = (
  request: Pick<PageRewriteRequest, 'status' | 'errorCode'>,
): boolean =>
  request.status === 'failed' &&
  request.errorCode?.startsWith('DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR') === true;
