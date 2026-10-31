'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { RunTasksItemResult, RunTasksParams, RunTasksState } from '../../../types';

const styles = stylex.create({
  failedBadge: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorError,
    background: cssVar.colorErrorBg,
  },
  header: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  headerCount: { fontSize: '13px', fontWeight: 500, color: cssVar.colorText },
  identifier: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillTertiary,
  },
  index: {
    flexShrink: 0,
    width: '18px',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
    textAlign: 'end',
  },
  meta: {
    overflow: 'hidden',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  row: { display: 'flex', gap: '8px', alignItems: 'center', minWidth: '0' },
  taskBody: { display: 'flex', flex: '1', flexDirection: 'column', gap: '4px', minWidth: '0' },
  taskItem: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'dashed', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

export const RunTasksRender = memo<BuiltinRenderProps<RunTasksParams, RunTasksState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('plugin');

    const identifiers = args?.identifiers ?? [];
    const results = pluginState?.results ?? [];

    if (identifiers.length === 0 && results.length === 0) return null;

    const rows: { identifier: string; result?: RunTasksItemResult }[] =
      results.length > 0
        ? results.map((r) => ({ identifier: r.identifier, result: r }))
        : identifiers.map((identifier) => ({ identifier }));
    const failedCount = pluginState?.failed ?? results.filter((r) => !r.success).length;

    return (
      <Block variant={'outlined'} width={'100%'}>
        <div {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.headerCount)}>
            {t('builtins.lobe-task.runTasks.count', { count: rows.length })}
          </span>
          {failedCount > 0 && (
            <span {...stylex.props(styles.failedBadge)}>
              {t('builtins.lobe-task.runTasks.failedCount', { count: failedCount })}
            </span>
          )}
        </div>
        {rows.map((row, index) => {
          const { result } = row;
          const success = result?.success === true;
          const failedRow = result?.success === false;

          return (
            <div {...stylex.props(styles.taskItem)} key={`${row.identifier}-${index}`}>
              <div {...stylex.props(styles.index)}>{index + 1}.</div>
              <div {...stylex.props(styles.taskBody)}>
                <div {...stylex.props(styles.row)}>
                  <span {...stylex.props(styles.identifier)}>{row.identifier}</span>
                  {success && (
                    <Icon icon={Check} size={14} style={{ color: cssVar.colorSuccess }} />
                  )}
                  {failedRow && <Icon icon={X} size={14} style={{ color: cssVar.colorError }} />}
                </div>
                {result?.topicId && (
                  <span {...stylex.props(styles.meta)}>topic {result.topicId}</span>
                )}
                {failedRow && (
                  <Text as={'span'} fontSize={11} type={'danger'}>
                    {result?.error || 'Failed'}
                  </Text>
                )}
              </div>
            </div>
          );
        })}
      </Block>
    );
  },
);

RunTasksRender.displayName = 'RunTasksRender';

export default RunTasksRender;
