import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import GuideActions from '../GuideActions';
import GuideShell from '../GuideShell';
import type { HeterogeneousAgentGuideStateProps } from '../types';

const OverloadedState = ({
  config,
  error,
  onRetry,
  variant,
}: HeterogeneousAgentGuideStateProps) => {
  const { t } = useTranslation('chat');
  const rawErrorDetails = error?.stderr || error?.message;

  return (
    <GuideShell
      icon={<config.icon size={24} />}
      title={t('cliOverloadedGuide.title', { name: config.title })}
      variant={variant}
      actions={
        <GuideActions retryLabel={t('cliOverloadedGuide.actions.retry')} onRetry={onRetry} />
      }
      headerDescription={
        <Text type="secondary">{t('cliOverloadedGuide.desc', { name: config.title })}</Text>
      }
    >
      <Text style={{ fontSize: 12 }} type="secondary">
        {t('cliOverloadedGuide.retryHint')}
      </Text>

      {rawErrorDetails && (
        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 12 }}>
            {t('cliOverloadedGuide.errorDetails')}
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

export default OverloadedState;
