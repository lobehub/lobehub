/**
 * Why a connector write (connect / re-authorize / remove) failed, kept on the
 * row so the settings list can explain the failure in place instead of relying
 * on a toast that is long gone once the user returns from the OAuth popup.
 */
export interface ConnectorActionError {
  action: 'connect' | 'remove';
  /**
   * Structured business reason, or tRPC code (e.g. `FORBIDDEN`) for a rejection,
   * `NETWORK` when the request never reached it, or `AUTH_INCOMPLETE` when the
   * OAuth window closed without granting access.
   */
  code?: string;
  /** Raw server/client message, shown when the code has no friendlier wording. */
  message?: string;
}

/**
 * A stored {@link ConnectorActionError}, stamped with the replica scope (user ×
 * workspace) it happened in. Rows are keyed by identifier, which repeats across
 * scopes, so a reader must not show one scope's failure on another's row.
 */
export interface ScopedConnectorActionError extends ConnectorActionError {
  scope: string;
}

/** The stored error, only when it belongs to the scope being viewed. */
export const errorInScope = (
  error: ScopedConnectorActionError | undefined,
  scope: string,
): ConnectorActionError | undefined => (error?.scope === scope ? error : undefined);

const NETWORK_MESSAGE_PATTERN = /failed to fetch|network|load failed/i;

export const getConnectorActionErrorCode = (error: unknown): string | undefined => {
  const data = (
    error as
      { data?: { code?: string; errorData?: { code?: string }; httpStatus?: number } } | undefined
  )?.data;
  const message = error instanceof Error ? error.message : error ? String(error) : undefined;

  let code = data?.errorData?.code ?? data?.code;
  if (!code && data?.httpStatus === 403) code = 'FORBIDDEN';
  if (!code && !data && message && NETWORK_MESSAGE_PATTERN.test(message)) code = 'NETWORK';

  return code;
};

export const toConnectorActionError = (
  action: ConnectorActionError['action'],
  error: unknown,
): ConnectorActionError => {
  const message = error instanceof Error ? error.message : error ? String(error) : undefined;

  return { action, code: getConnectorActionErrorCode(error), message };
};
