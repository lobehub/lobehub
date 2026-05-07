'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { CheckCircle2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  done: css`
    color: ${cssVar.colorSuccess};
  `,
}));

export const FinishOnboardingInspector = memo<
  BuiltinInspectorProps<Record<string, never>, Record<string, unknown>>
>(({ isArgumentsStreaming, isLoading, result }) => {
  const { t } = useTranslation('plugin');
  const succeeded = !!result && !result.error;

  return (
    <div
      style={{ gap: 6 }}
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-web-onboarding.apiName.finishOnboarding')}</span>
      {succeeded && <Icon className={styles.done} icon={CheckCircle2} size={14} />}
    </div>
  );
});

FinishOnboardingInspector.displayName = 'FinishOnboardingInspector';

export default FinishOnboardingInspector;
