'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ReplaceContentArgs, ReplaceContentState } from '../../../types';
import { formatPageId, inspectorChipStyles } from '../_styles';

export const ReplaceContentInspector = memo<
  BuiltinInspectorProps<ReplaceContentArgs, ReplaceContentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const id = args?.id || partialArgs?.id;
  const content = args?.content || partialArgs?.content;
  const styles = inspectorChipStyles;

  if (isArgumentsStreaming && !id) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-personal-pages.apiName.replaceContent')}</span>
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
      <span>{t('builtins.lobe-personal-pages.apiName.replaceContent')}</span>
      {id && <span className={styles.idChip}>{formatPageId(id)}</span>}
      {typeof content === 'string' && content.length > 0 && (
        <>
          <span className={styles.separator}>·</span>
          <span className={styles.subdued}>
            {t('builtins.lobe-personal-pages.inspector.chars', { count: content.length })}
          </span>
        </>
      )}
    </div>
  );
});

ReplaceContentInspector.displayName = 'ReplaceContentInspector';

export default ReplaceContentInspector;
