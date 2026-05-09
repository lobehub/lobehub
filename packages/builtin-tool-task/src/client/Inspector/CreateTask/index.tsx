'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CornerDownRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CreateTaskParams, CreateTaskState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    max-width: 240px;
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  identifierChip: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  subtaskTag: css`
    display: inline-flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;

    padding-block: 1px;
    padding-inline: 6px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};

    background: transparent;
  `,
}));

export const CreateTaskInspector = memo<BuiltinInspectorProps<CreateTaskParams, CreateTaskState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const name = args?.name || partialArgs?.name;
    const identifier = pluginState?.identifier;
    const parentIdentifier = args?.parentIdentifier || partialArgs?.parentIdentifier;

    if (isArgumentsStreaming && !name) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-task.apiName.createTask')}</span>
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
        <span>{t('builtins.lobe-task.apiName.createTask')}</span>
        {identifier && (
          <span className={styles.identifierChip} style={{ marginInlineStart: 6 }}>
            {identifier}
          </span>
        )}
        {name && (
          <span className={styles.chip} style={{ color: cssVar.colorText }}>
            {name}
          </span>
        )}
        {parentIdentifier && (
          <Tooltip title={t('builtins.lobe-task.create.subtaskOf', { parent: parentIdentifier })}>
            <span className={styles.subtaskTag}>
              <Icon icon={CornerDownRight} size={11} />
              {parentIdentifier}
            </span>
          </Tooltip>
        )}
      </div>
    );
  },
);

CreateTaskInspector.displayName = 'CreateTaskInspector';

export default CreateTaskInspector;
