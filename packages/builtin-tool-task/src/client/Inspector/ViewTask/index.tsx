'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ViewTaskParams, ViewTaskState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  identifierChip: css`
    flex-shrink: 0;

    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

export const ViewTaskInspector = memo<BuiltinInspectorProps<ViewTaskParams, ViewTaskState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const identifier = args?.identifier || partialArgs?.identifier || pluginState?.identifier;

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{t('builtins.lobe-task.apiName.viewTask')}</span>
        {identifier && <span className={styles.identifierChip}>{identifier}</span>}
      </div>
    );
  },
);

ViewTaskInspector.displayName = 'ViewTaskInspector';

export default ViewTaskInspector;
