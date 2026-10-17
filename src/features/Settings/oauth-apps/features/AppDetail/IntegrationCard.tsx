'use client';

import { Button, createStaticStyles, Flexbox, Text, toast } from '@lobehub/ui';
import { CopyIcon } from 'lucide-react';
import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

import { getIntegrationEndpoints, resolveIssuer } from '../../integrationEndpoints';
import { integrationPromptKey, integrationPromptValues } from '../../integrationPrompt';
import SectionCard from './SectionCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  prompt: css`
    overflow: auto;

    max-height: 180px;
    padding-block: 10px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    white-space: pre-wrap;

    background: ${cssVar.colorFillTertiary};
  `,
  subTitle: css`
    font-size: 13px;
    font-weight: 500;
  `,
}));

interface IntegrationCardProps {
  applicationType?: string | null;
  clientId: string;
  name: string;
}

/**
 * The endpoints of this deployment's OIDC provider for an app of the given
 * type: the server's configured issuer (APP_URL), which also covers desktop and
 * reverse-proxied deployments; the app origin (the connected server on
 * desktop) is only a fallback for a server too old to send it.
 */
export const useIntegrationEndpoints = (applicationType?: string | null) => {
  const configuredIssuer = useServerConfigStore(serverConfigSelectors.oidcIssuer);
  const appOrigin = useAppOrigin();
  const issuer = resolveIssuer(configuredIssuer, appOrigin);

  return useMemo(() => getIntegrationEndpoints(issuer, applicationType), [issuer, applicationType]);
};

/**
 * How to wire the app into a project: one prompt the developer pastes into a
 * coding agent, filled with this app's real client ID and endpoints. The raw
 * URLs for configuring a client by hand live on the Credentials tab
 * (`ManualSetupCard`).
 */
const IntegrationCard: FC<IntegrationCardProps> = ({ applicationType, clientId, name }) => {
  const { t } = useTranslation('auth');
  const endpoints = useIntegrationEndpoints(applicationType);

  const prompt = t(
    integrationPromptKey(applicationType),
    integrationPromptValues(endpoints, { clientId, name }),
  );

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(t('oauthApp.integration.promptCopied'));
    } catch {
      toast.error(t('oauthApp.copy.error'));
    }
  };

  return (
    <SectionCard title={t('oauthApp.integration.title')}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Flexbox gap={2}>
            <span className={styles.subTitle}>{t('oauthApp.integration.oneClick')}</span>
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('oauthApp.integration.oneClickDesc')}
            </Text>
          </Flexbox>
          <Button
            icon={<CopyIcon size={14} />}
            style={{ flex: 'none' }}
            type={'primary'}
            onClick={copyPrompt}
          >
            {t('oauthApp.integration.copyPrompt')}
          </Button>
        </Flexbox>
        <div className={styles.prompt}>{prompt}</div>
      </Flexbox>
    </SectionCard>
  );
};

export default IntegrationCard;
