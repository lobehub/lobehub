'use client';

import { SELF_HOSTING_DOCUMENTS } from '@lobechat/const';
import { Alert, Button, Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

type UnavailableReason = 'marketUnauthorized' | 'noGateway' | 'sandboxUnconfigured';

const DOCS: Record<Exclude<UnavailableReason, 'marketUnauthorized'>, string> = {
  noGateway: urlJoin(SELF_HOSTING_DOCUMENTS, '/environment-variables/basic#enable_agent_gateway'),
  sandboxUnconfigured: urlJoin(SELF_HOSTING_DOCUMENTS, '/environment-variables/cloud-sandbox'),
};

/**
 * Why the page agent can't edit the page here: it runs on the server
 * (Gateway Mode) and edits through the cloud sandbox. Mirrors the server's
 * injection gate, so the copilot says why instead of just lacking the tools.
 */
const usePageAgentUnavailableReason = (): UnavailableReason | undefined => {
  const gatewayReady = useServerConfigStore(
    (s) => !!s.serverConfig.agentGatewayUrl && serverConfigSelectors.enableGatewayMode(s),
  );
  const sandbox = useServerConfigStore(serverConfigSelectors.sandbox);
  const { isAuthenticated, isLoading } = useMarketAuth();

  if (!gatewayReady) return 'noGateway';
  if (sandbox === 'unconfigured') return 'sandboxUnconfigured';
  if (sandbox === 'market' && !isAuthenticated && !isLoading) return 'marketUnauthorized';
};

const PageAgentUnavailableAlert = () => {
  const { t } = useTranslation('file');
  const reason = usePageAgentUnavailableReason();
  const { signIn } = useMarketAuth();
  const dismissId = `page-agent-unavailable:${reason}`;
  const dismissed = useGlobalStore(systemStatusSelectors.isBannerDismissed(dismissId));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  if (!reason || dismissed) return null;

  const action =
    reason === 'marketUnauthorized' ? (
      <Button size={'small'} onClick={() => void signIn('sandbox')}>
        {t('pageEditor.agentUnavailable.connectMarket')}
      </Button>
    ) : (
      <Button href={DOCS[reason]} size={'small'} target={'_blank'}>
        {t('pageEditor.agentUnavailable.viewDocs')}
      </Button>
    );

  return (
    <Flexbox paddingBlock={8} paddingInline={16}>
      <Alert
        showIcon
        action={action}
        title={t(`pageEditor.agentUnavailable.${reason}`)}
        type="info"
        closable={{
          onClose: () => {
            const current = useGlobalStore.getState().status.dismissedBannerIds || [];
            if (!current.includes(dismissId)) {
              updateSystemStatus({ dismissedBannerIds: [...current, dismissId] });
            }
          },
        }}
      />
    </Flexbox>
  );
};

export default PageAgentUnavailableAlert;
