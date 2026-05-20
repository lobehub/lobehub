'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
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
  const styles = inspectorChipStyles;

  if (isArgumentsStreaming && !id) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-documents.apiName.updateLoadRule')}</span>
      </div>
    );
  }

  return (
    <div
      style={{ flexWrap: 'wrap', gap: 4 }}
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-agent-documents.apiName.updateLoadRule')}</span>
      {id && <span className={styles.idChip}>{formatDocumentId(id)}</span>}
      {ruleType && (
        <>
          <span className={styles.separator}>·</span>
          <span className={styles.subdued}>{ruleType}</span>
        </>
      )}
    </div>
  );
});

UpdateLoadRuleInspector.displayName = 'UpdateLoadRuleInspector';

export default UpdateLoadRuleInspector;
