'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckCircle2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

const styles = stylex.create({ done: { color: cssVar.colorSuccess } });

export const FinishOnboardingInspector = memo<
  BuiltinInspectorProps<Record<string, never>, Record<string, unknown>>
>(({ isArgumentsStreaming, isLoading, result }) => {
  const { t } = useTranslation('plugin');
  const succeeded = !!result && !result.error;

  return (
    <div className={inspectorTextStyles.root} style={{ gap: 6 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-web-onboarding.apiName.finishOnboarding')}
      </span>
      {succeeded && (
        <Icon className={stylex.props(styles.done).className} icon={CheckCircle2} size={14} />
      )}
    </div>
  );
});

FinishOnboardingInspector.displayName = 'FinishOnboardingInspector';

export default FinishOnboardingInspector;
