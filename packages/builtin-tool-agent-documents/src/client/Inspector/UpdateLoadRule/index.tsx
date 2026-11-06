'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpdateLoadRuleArgs, UpdateLoadRuleState } from '../../../types';
import { formatDocumentId, inspectorChipStyles } from '../_styles';

export const UpdateLoadRuleInspector = memo<
  BuiltinInspectorProps<UpdateLoadRuleArgs, UpdateLoadRuleState>
>(({ args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const id = args?.id || partialArgs?.id;
  const ruleType = args?.rule?.rule || partialArgs?.rule?.rule || pluginState?.rule?.rule;

  if (isArgumentsStreaming && !id) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-agent-documents.apiName.updateLoadRule')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-agent-documents.apiName.updateLoadRule')}
      </span>
      {id && <span {...stylex.props(inspectorChipStyles.idChip)}>{formatDocumentId(id)}</span>}
      {ruleType && (
        <>
          <span {...stylex.props(inspectorChipStyles.separator)}>·</span>
          <span {...stylex.props(inspectorChipStyles.subdued)}>{ruleType}</span>
        </>
      )}
    </div>
  );
});

UpdateLoadRuleInspector.displayName = 'UpdateLoadRuleInspector';

export default UpdateLoadRuleInspector;
