import { Flexbox, Highlighter } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ClockAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import GuideActions from '../GuideActions';
import GuideShell from '../GuideShell';
import type { HeterogeneousAgentGuideStateProps } from '../types';

const CliDetectionTimeoutState = ({
  config,
  error,
  onOpenSystemTools,
  onRetry,
  variant,
}: HeterogeneousAgentGuideStateProps) => {
  const { t } = useTranslation('chat');
  const rawErrorDetails = error?.stderr || error?.message;

  return (
    <GuideShell
      icon={<ClockAlert color={cssVar.colorWarning} size={20} />}
      title={t('cliDetectionTimeoutGuide.title', { name: config.title })}
      variant={variant}
      actions={
        <GuideActions
          retryPrimary
          openSystemToolsLabel={t('cliDetectionTimeoutGuide.actions.openSystemTools')}
          retryLabel={t('cliDetectionTimeoutGuide.actions.retry')}
          onOpenSystemTools={onOpenSystemTools}
          onRetry={onRetry}
        />
      }
      headerDescription={
        <Text type="secondary">
          {t('cliDetectionTimeoutGuide.desc', { command: error?.command || config.title })}
        </Text>
      }
    >
      <Text style={{ fontSize: 12 }} type="secondary">
        {t('cliDetectionTimeoutGuide.hint')}
      </Text>

      {rawErrorDetails && (
        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 12 }}>
            {t('cliDetectionTimeoutGuide.errorDetails')}
          </Text>
          <Highlighter
            wrap
            actionIconSize={'small'}
            language={'log'}
            padding={0}
            style={{ maxHeight: 160, overflow: 'auto' }}
            variant={'outlined'}
          >
            {rawErrorDetails}
          </Highlighter>
        </Flexbox>
      )}
    </GuideShell>
  );
};

export default CliDetectionTimeoutState;
