import { Flexbox, Highlighter, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Ban, Loader2, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import GuideActions from '../GuideActions';
import GuideShell from '../GuideShell';
import type { HeterogeneousAgentGuideStateProps } from '../types';

const OverloadedState = ({
  autoRetry,
  config,
  error,
  onRetry,
  variant,
}: HeterogeneousAgentGuideStateProps) => {
  const { t } = useTranslation('chat');
  const rawErrorDetails = error?.stderr || error?.message;

  // Auto-retry pending: a lightweight progress card. Keep it compact — the
  // countdown is folded into the description line and the raw error details are
  // hidden (they stay on the manual/exhausted card below, where the user is
  // actually stuck and may want to copy them).
  if (autoRetry) {
    return (
      <GuideShell
        compact
        icon={<Icon spin icon={Loader2} size={18} />}
        title={t('cliOverloadedGuide.autoRetry.title', { name: config.title })}
        variant={variant}
        actions={
          <Flexbox horizontal gap={8} justify="flex-end" style={{ flexWrap: 'wrap' }}>
            <Button icon={<Ban size={14} />} size="small" type="text" onClick={autoRetry.onCancel}>
              {t('cliOverloadedGuide.autoRetry.actions.cancel')}
            </Button>
            <Button icon={<RotateCcw size={14} />} size="small" onClick={autoRetry.onRetryNow}>
              {t('cliOverloadedGuide.autoRetry.actions.retryNow')}
            </Button>
          </Flexbox>
        }
        headerDescription={
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('cliOverloadedGuide.autoRetry.status', {
              attempt: autoRetry.attempt,
              max: autoRetry.maxAttempts,
              seconds: autoRetry.secondsLeft,
            })}
          </Text>
        }
      />
    );
  }

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
            style={{ maxHeight: 200, overflow: 'auto' }}
            variant={'outlined'}
          >
            {rawErrorDetails}
          </Highlighter>
        </Flexbox>
      )}
    </GuideShell>
  );
};

export default OverloadedState;
