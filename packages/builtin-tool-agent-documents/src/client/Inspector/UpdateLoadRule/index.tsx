'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpdateLoadRuleArgs, UpdateLoadRuleState } from '../../../types';

export const UpdateLoadRuleInspector = memo<
  BuiltinInspectorProps<UpdateLoadRuleArgs, UpdateLoadRuleState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');
  const id = args?.id || partialArgs?.id;

  if (isArgumentsStreaming && !id) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-documents.apiName.updateLoadRule')}</span>
      </div>
    );
  }

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-agent-documents.apiName.updateLoadRule')}: </span>
      {id && <span className={highlightTextStyles.primary}>{id}</span>}
    </div>
  );
});

UpdateLoadRuleInspector.displayName = 'UpdateLoadRuleInspector';

export default UpdateLoadRuleInspector;
