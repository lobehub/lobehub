import type { TaskTemplateConnectorReference } from '@lobechat/const';
import { Alert, Button, Flexbox, toast } from '@lobehub/ui';
import { KeyRound, LockKeyhole } from 'lucide-react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ConnectorConnectionMarketAuthRequiredError,
  ConnectorConnectionPopupBlockedError,
  useConnectorConnection,
} from '@/features/RecommendTaskTemplates/useConnectorConnection';
import { createCreateCredModal } from '@/features/Settings/creds/features/CreateCredModal';
import { personalCredsApi } from '@/features/Settings/creds/features/useCredsApi';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';

const GITHUB: TaskTemplateConnectorReference[] = [{ identifier: 'github', source: 'lobehub' }];

/** The Vault entry the server reads a GitHub token from; the person pastes only the value. */
export const GITHUB_TOKEN_PRESET = {
  key: 'github',
  keys: ['GITHUB_TOKEN'],
  name: 'GitHub',
};

/**
 * Shown when GitHub won't hand a repository over: it is private, gone, or the
 * address is wrong. Two ways to grant access, then the same scan again:
 * connect GitHub, or save a personal access token in the Vault.
 */
const GithubAccessRecovery = memo<{ onResolved: () => void; recovery: 'access' | 'connect' }>(
  ({ onResolved, recovery }) => {
    const { t } = useTranslation(['setting', 'common']);
    const { connect, isAllConnected, isConnecting } = useConnectorConnection(GITHUB);
    const { isAuthenticated, signIn } = useMarketAuth();
    const startedHere = useRef(false);

    // Scan again once a connect started here lands.
    useEffect(() => {
      if (startedHere.current && isAllConnected) {
        startedHere.current = false;
        onResolved();
      }
    }, [isAllConnected, onResolved]);

    const connectGithub = async () => {
      startedHere.current = true;
      try {
        await connect();
      } catch (error) {
        startedHere.current = false;
        if (error instanceof ConnectorConnectionMarketAuthRequiredError) return;
        toast.error(
          t(
            error instanceof ConnectorConnectionPopupBlockedError
              ? 'common:taskTemplate.action.connect.popupBlocked'
              : 'common:taskTemplate.action.connect.error',
          ),
        );
      }
    };

    const addToken = useCallback(async () => {
      // The Vault lives in the Market account.
      if (!isAuthenticated && !(await signIn())) return;
      createCreateCredModal({
        credsApi: personalCredsApi,
        type: 'kv-env',
        kvPreset: {
          ...GITHUB_TOKEN_PRESET,
          description: t('market.skills.github.recovery.tokenDescription'),
        },
        onSuccess: onResolved,
      });
    }, [isAuthenticated, onResolved, signIn, t]);

    return (
      <Alert
        showIcon
        icon={LockKeyhole}
        type={'warning'}
        description={
          <Flexbox gap={12}>
            {t('market.skills.github.recovery.desc')}
            <Flexbox horizontal gap={8} wrap={'wrap'}>
              {!isAllConnected && (
                <Button loading={isConnecting} type={'fill'} onClick={() => void connectGithub()}>
                  {t('market.skills.github.recovery.connect')}
                </Button>
              )}
              <Button icon={KeyRound} type={'fill'} onClick={() => void addToken()}>
                {t('market.skills.github.recovery.addToken')}
              </Button>
            </Flexbox>
          </Flexbox>
        }
        title={t(
          recovery === 'connect'
            ? 'market.skills.github.recovery.connectTitle'
            : 'market.skills.github.recovery.accessTitle',
        )}
      />
    );
  },
);

GithubAccessRecovery.displayName = 'MarketplaceGithubAccessRecovery';

export default GithubAccessRecovery;
