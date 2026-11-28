import { ConnectorOAuthError } from '@/utils/connectorOAuth';

interface TRPCLikeError {
  data?: { code?: string; errorData?: { type?: unknown }; httpStatus?: number };
  message?: string;
}

export interface SaveErrorToast {
  /** Server-provided reason the user can act on, shown under the title. */
  description?: string;
  /** `plugin` namespace key for the toast title. */
  titleKey: string;
}

/**
 * Map a failed install/update to its inline error: an actionable title plus the
 * server reason as folded detail. On the OAuth path that reason (discovery failed,
 * registration rejected, …) is the only thing that tells the user what to change.
 */
export const getSaveErrorToast = (error: unknown, isOAuth: boolean): SaveErrorToast => {
  const trpcData = (error as TRPCLikeError | undefined)?.data;
  const reason = (error as TRPCLikeError | undefined)?.message?.trim();

  // The server refused the MCP address (private / reserved IP): the reason says
  // which address class and the self-hosting switches that allow it.
  if (trpcData?.errorData?.type === 'SSRF_BLOCKED') {
    return { description: reason || undefined, titleKey: 'dev.ssrfBlockedRetry' };
  }
  if (error instanceof ConnectorOAuthError) return { titleKey: `dev.oauthError.${error.reason}` };

  // Every other failure keeps the server reason as folded detail, so the user can
  // see why it failed (e.g. a rejected OAuth registration) behind "Show details".
  const description = reason || undefined;
  if (trpcData?.httpStatus === 403) return { description, titleKey: 'dev.permissionDenied' };
  if (!isOAuth) return { description, titleKey: 'dev.saveFailedRetry' };

  return { description, titleKey: 'dev.oauthError.failed' };
};
