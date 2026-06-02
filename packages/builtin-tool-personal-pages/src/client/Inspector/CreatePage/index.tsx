'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CreatePageArgs, CreatePageState } from '../../../types';
import { inspectorChipStyles } from '../_styles';

export const CreatePageInspector = memo<BuiltinInspectorProps<CreatePageArgs, CreatePageState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const title = args?.title || partialArgs?.title;
    const styles = inspectorChipStyles;

    if (isArgumentsStreaming && !title) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-personal-pages.apiName.createPage')}</span>
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
        <span>{t('builtins.lobe-personal-pages.apiName.createPage')}</span>
        {title && <span className={styles.chip}>{title}</span>}
      </div>
    );
  },
);

CreatePageInspector.displayName = 'CreatePageInspector';

export default CreatePageInspector;
