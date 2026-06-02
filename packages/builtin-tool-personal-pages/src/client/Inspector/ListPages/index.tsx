'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ListPagesArgs, ListPagesState } from '../../../types';
import { inspectorChipStyles } from '../_styles';

export const ListPagesInspector = memo<BuiltinInspectorProps<ListPagesArgs, ListPagesState>>(
  ({ pluginState, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const count = pluginState?.documents?.length;
    const styles = inspectorChipStyles;

    return (
      <div
        style={{ flexWrap: 'wrap', gap: 4 }}
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{t('builtins.lobe-personal-pages.apiName.listPages')}</span>
        {typeof count === 'number' && (
          <>
            <span className={styles.separator}>·</span>
            <span className={styles.subdued}>
              {t('builtins.lobe-personal-pages.inspector.pageCount', { count })}
            </span>
          </>
        )}
      </div>
    );
  },
);

ListPagesInspector.displayName = 'ListPagesInspector';

export default ListPagesInspector;
