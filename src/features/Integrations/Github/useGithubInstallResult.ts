import { confirmModal, toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { scmService } from '@/services/scm';

import { useInstallResult } from '../useInstallResult';

const KNOWN_ERRORS = new Set([
  'exchange_failed',
  'identity_taken',
  'installation_fetch_failed',
  'missing_installation',
  'workspace_forbidden',
]);

/** Reports what the GitHub App install callback put in the query. */
export const useGithubInstallResult = (onBound: () => void) => {
  const { t, ready } = useTranslation('integration');

  useInstallResult(ready, ({ account, error, installed, pending }) => {
    if (installed === 'ok') toast.success(t('github.installResult.success', { account }));
    else if (installed === 'updated') toast.success(t('github.installResult.updated'));
    else if (error && KNOWN_ERRORS.has(error)) {
      toast.error(t(`github.installResult.error.${error}` as any));
    } else if (error) toast.error(t('github.installResult.error.unknown', { code: error }));

    // An installation that reached the callback without our state (started
    // on github.com) is not bound until the user confirms it here. `pending`
    // is the single-use claim that callback minted, not an installation id;
    // the server only issues one for an installation this user does not
    // already have, so a connected account never reaches this dialog.
    if (pending) {
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('github.pending.content', { account: account ?? '' }),
        okText: t('github.pending.confirm'),
        onOk: async () => {
          try {
            const bound = await scmService.connectInstallation({ claim: pending });
            toast.success(t('github.installResult.success', { account: bound.accountLogin }));
            onBound();
          } catch {
            toast.error(t('github.pending.failed'));
          }
        },
        title: t('github.pending.title'),
      });
    }
  });
};
