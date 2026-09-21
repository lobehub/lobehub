'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { WebOnboardingDocumentType } from '../../../types';
import { inspectorChipStyles } from '../_styles';

interface WriteDocumentArgs {
  content?: string;
  type?: WebOnboardingDocumentType;
}

export const WriteDocumentInspector = memo<
  BuiltinInspectorProps<WriteDocumentArgs, Record<string, unknown>>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');
  const styles = inspectorChipStyles;

  const type = args?.type ?? partialArgs?.type;
  const content = args?.content ?? partialArgs?.content;
  const charCount = content?.length ?? 0;

  if (isArgumentsStreaming && !type) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-web-onboarding.apiName.writeDocument')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-web-onboarding.apiName.writeDocument')}
      </span>
      {type && (
        <span className={styles.chip}>
          {t(`builtins.lobe-web-onboarding.docType.${type}` as const)}
        </span>
      )}
      {charCount > 0 && (
        <span className={styles.meta}>
          {t('builtins.lobe-web-onboarding.inspector.charCount', { count: charCount })}
        </span>
      )}
    </div>
  );
});

WriteDocumentInspector.displayName = 'WriteDocumentInspector';

export default WriteDocumentInspector;
