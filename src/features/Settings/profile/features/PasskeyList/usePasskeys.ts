import { toast } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useListPasskeys } from '@/libs/better-auth/auth-client';
import { PASSKEY_DELETE_REQUIRES_FALLBACK_ERROR } from '@/libs/better-auth/constants';

export interface PasskeyItem {
  createdAt?: Date | string | null;
  id: string;
  name?: string | null;
}

/**
 * Passkey registration and removal for the signed-in user.
 *
 * `useListPasskeys` is the plugin's own reactive query, so the list refreshes
 * itself after mutations instead of us keeping a duplicate copy in a store.
 *
 * WebAuthn surfaces user cancellation as a thrown `NotAllowedError` rather than
 * an API error. That is an ordinary outcome — the user dismissed the browser
 * prompt — so it must not be reported as a failure.
 */
export const usePasskeys = () => {
  const { t } = useTranslation('auth');
  // A failed query must not look like an empty list: claiming "no passkeys"
  // while credentials merely failed to load invites a pointless re-enrol.
  const { data, error, isPending, refetch } = useListPasskeys();

  const addPasskey = useCallback(async () => {
    const { passkey } = await import('@/libs/better-auth/auth-client');

    try {
      const result = await passkey.addPasskey();

      // better-auth returns errors in the payload; only a thrown error means
      // the browser-side ceremony itself failed.
      if (result?.error) {
        toast.error(result.error.message || t('profile.passkey.addError'));
        return false;
      }

      toast.success(t('profile.passkey.addSuccess'));
      await refetch();
      return true;
    } catch (error) {
      // The user dismissed the platform prompt, or no authenticator is
      // available. Neither deserves an error toast.
      if (
        error instanceof Error &&
        (error.name === 'NotAllowedError' || error.name === 'AbortError')
      ) {
        return false;
      }
      toast.error(t('profile.passkey.addError'));
      return false;
    }
  }, [refetch, t]);

  const deletePasskey = useCallback(
    async (id: string) => {
      const { passkey } = await import('@/libs/better-auth/auth-client');

      const result = await passkey.deletePasskey({ id });
      if (result?.error) {
        toast.error(
          result.error.code === PASSKEY_DELETE_REQUIRES_FALLBACK_ERROR
            ? t('profile.passkey.delete.forbidden')
            : result.error.message || t('profile.passkey.deleteError'),
        );
        return false;
      }

      toast.success(t('profile.passkey.deleteSuccess'));
      await refetch();
      return true;
    },
    [refetch, t],
  );

  const renamePasskey = useCallback(
    async (id: string, name: string) => {
      const { passkey } = await import('@/libs/better-auth/auth-client');

      const result = await passkey.updatePasskey({ id, name });
      if (result?.error) {
        toast.error(result.error.message || t('profile.passkey.renameError'));
        return false;
      }

      await refetch();
      return true;
    },
    [refetch, t],
  );

  return {
    addPasskey,
    deletePasskey,
    renamePasskey,
    isError: !!error,
    isLoading: isPending,
    passkeys: (data ?? []) as PasskeyItem[],
    refetch,
  };
};
