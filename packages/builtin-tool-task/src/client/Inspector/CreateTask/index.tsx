'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CornerDownRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CreateTaskParams, CreateTaskState } from '../../../types';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: '0',
    maxWidth: '240px',
    marginInlineStart: '6px',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    background: cssVar.colorFillTertiary,
  },
  identifierChip: {
    flexShrink: 0,
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillTertiary,
  },
  subtaskTag: {
    display: 'inline-flex',
    flexShrink: 0,
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
    background: 'transparent',
  },
});

export const CreateTaskInspector = memo<BuiltinInspectorProps<CreateTaskParams, CreateTaskState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const name = args?.name || partialArgs?.name;
    const identifier = pluginState?.identifier;
    const parentIdentifier = args?.parentIdentifier || partialArgs?.parentIdentifier;

    if (isArgumentsStreaming && !name) {
      return (
        <div className={inspectorTextStyles.root}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-task.apiName.createTask')}
          </span>
        </div>
      );
    }

    return (
      <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {t('builtins.lobe-task.apiName.createTask')}
        </span>
        {identifier && (
          <span
            className={stylex.props(styles.identifierChip).className}
            style={{ marginInlineStart: 6 }}
          >
            {identifier}
          </span>
        )}
        {name && (
          <span className={stylex.props(styles.chip).className} style={{ color: cssVar.colorText }}>
            {name}
          </span>
        )}
        {parentIdentifier && (
          <Tooltip title={t('builtins.lobe-task.create.subtaskOf', { parent: parentIdentifier })}>
            <span {...stylex.props(styles.subtaskTag)}>
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
