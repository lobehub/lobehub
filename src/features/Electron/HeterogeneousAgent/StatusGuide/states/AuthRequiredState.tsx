import { isDesktop } from '@lobechat/const';
import { Flexbox, Highlighter, Snippet, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useDensity } from '@/styles/density';

import GuideActions from '../GuideActions';
import GuideShell from '../GuideShell';
import type { HeterogeneousAgentGuideStateProps } from '../types';

const AuthRequiredState = ({
  config,
  error,
  onOpenSystemTools,
  variant,
}: HeterogeneousAgentGuideStateProps) => {
  const { t } = useTranslation('chat');
  const { compact } = useDensity();
  const snippetSize = compact ? { height: 32 } : undefined;
  const rawErrorDetails = error?.stderr || error?.message;
  const docsUrl = error?.docsUrl || config.docsUrl;

  return (
    <GuideShell
      icon={<config.icon size={24} />}
      title={t('cliAuthGuide.title', { name: config.title })}
      variant={variant}
      actions={
        <GuideActions
          showDocs
          docsUrl={docsUrl}
          openDocsLabel={t('cliAuthGuide.actions.openDocs')}
          openSystemToolsLabel={t(
            isDesktop
              ? 'cliAuthGuide.actions.openSystemTools'
              : 'cliAuthGuide.actions.openCloudCredentials',
          )}
          onOpenSystemTools={onOpenSystemTools}
        />
      }
      headerDescription={
        <Text type="secondary">{t('cliAuthGuide.desc', { name: config.title })}</Text>
      }
    >
      {isDesktop && (
        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 12 }}>
            {t('cliAuthGuide.runCommand')}
          </Text>
          <Snippet language={'bash'} {...snippetSize}>
            {config.signInCommand}
          </Snippet>
        </Flexbox>
      )}

      <Text style={{ fontSize: 12 }} type="secondary">
        {t(isDesktop ? 'cliAuthGuide.afterLogin' : 'cliAuthGuide.cloudAfterUpdate')}
      </Text>

      {rawErrorDetails && (
        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 12 }}>
            {t('cliAuthGuide.errorDetails')}
          </Text>
          <Highlighter
            wrap
            actionIconSize={'small'}
            language={'log'}
            padding={12}
            variant={'outlined'}
            style={{
              maxHeight: 200,
              overflow: 'auto',
            }}
          >
            {rawErrorDetails}
          </Highlighter>
        </Flexbox>
      )}
    </GuideShell>
  );
};

export default AuthRequiredState;
