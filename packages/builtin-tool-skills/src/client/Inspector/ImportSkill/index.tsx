'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ImportSkillParams, ImportSkillState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

export const ImportSkillInspector = memo<
  BuiltinInspectorProps<ImportSkillParams, ImportSkillState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const url = args?.url || partialArgs?.url;
  const displayName = pluginState?.name || url;

  if (isArgumentsStreaming && !url) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-skills.apiName.importSkill')}</span>
      </div>
    );
  }

  const isSuccess = pluginState?.success;
  const hasResult = pluginState?.success !== undefined;

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-skills.apiName.importSkill')}: </span>
      {displayName && <span className={highlightTextStyles.primary}>{displayName}</span>}
      {!isLoading &&
        hasResult &&
        (isSuccess ? (
          <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
        ) : (
          <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
        ))}
    </div>
  );
});

ImportSkillInspector.displayName = 'ImportSkillInspector';
