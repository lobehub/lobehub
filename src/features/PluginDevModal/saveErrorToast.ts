import { ConnectorOAuthError } from '@/utils/connectorOAuth';

interface TRPCLikeError {
  data?: { code?: string; httpStatus?: number };
  message?: string;
}

export interface SaveErrorToast {
  /** Server-provided reason the user can act on, shown under the title. */
  description?: string;
  /** `plugin` namespace key for the toast title. */
  titleKey: string;
}

/**
 * Map a failed install/update to its toast. On the OAuth path a BAD_REQUEST
 * carries the authorization server's reason (discovery failed, registration
 * rejected, …) — the only thing that tells the user what to change in their
 * OAuth setup — so show it rather than collapsing it into the generic message.
 */
export const getSaveErrorToast = (error: unknown, isOAuth: boolean): SaveErrorToast => {
  const trpcData = (error as TRPCLikeError | undefined)?.data;

  if (trpcData?.httpStatus === 403) return { titleKey: 'dev.permissionDenied' };
  if (error instanceof ConnectorOAuthError) return { titleKey: `dev.oauthError.${error.reason}` };
  if (!isOAuth) return { titleKey: 'dev.saveError' };

  const reason = (error as TRPCLikeError).message?.trim();
  return {
    description: trpcData?.code === 'BAD_REQUEST' && reason ? reason : undefined,
    titleKey: 'dev.oauthError.failed',
  };
};
