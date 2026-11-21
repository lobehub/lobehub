import { confirmModal, toast } from '@lobehub/ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router';

import { scmService } from '@/services/scm';

import { GITHUB_INSTALL_RESULT_PARAMS } from './home';

const KNOWN_ERRORS = new Set([
  'exchange_failed',
  'identity_taken',
  'installation_fetch_failed',
  'missing_installation',
  'workspace_forbidden',
]);

/**
 * Reports what the GitHub App install callback put in the query, once, and
 * clears it. Goes through the router so the host page's own params (the open
 * Marketplace detail) and history state survive.
 */
export const useGithubInstallResult = (onBound: () => void) => {
  const { t, ready } = useTranslation('integration');
  const [searchParams, setSearchParams] = useSearchParams();
  const { state } = useLocation();
  const handled = useRef<string>(undefined);

  const installed = searchParams.get('installed');
  const error = searchParams.get('error');
  const account = searchParams.get('account');
  const pending = searchParams.get('pending');

  useEffect(() => {
    if (!installed && !error && !pending) {
      // Cleared: the same outcome from a later install is a new report.
      handled.current = undefined;
      return;
    }
    if (!ready) return;
    const result = JSON.stringify([installed, error, account, pending]);
    if (handled.current === result) return;
    handled.current = result;

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

    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const key of GITHUB_INSTALL_RESULT_PARAMS) next.delete(key);
        return next;
      },
      { replace: true, state },
    );
  }, [account, error, installed, onBound, pending, ready, setSearchParams, state, t]);
};
