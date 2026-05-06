'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { RunTasksItemResult, RunTasksParams, RunTasksState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  failedBadge: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorError};

    background: ${cssVar.colorErrorBg};
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  headerCount: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  identifier: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  index: css`
    flex-shrink: 0;

    width: 18px;

    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
    text-align: end;
  `,
  meta: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  `,
  taskBody: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;

    min-width: 0;
  `,
  taskItem: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;

    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px dashed ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
}));

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
        <div className={styles.header}>
          <span className={styles.headerCount}>
            {t('builtins.lobe-task.runTasks.count', { count: rows.length })}
          </span>
          {failedCount > 0 && (
            <span className={styles.failedBadge}>
              {t('builtins.lobe-task.runTasks.failedCount', { count: failedCount })}
            </span>
          )}
        </div>
        {rows.map((row, index) => {
          const { result } = row;
          const success = result?.success === true;
          const failedRow = result?.success === false;

          return (
            <div className={styles.taskItem} key={`${row.identifier}-${index}`}>
              <div className={styles.index}>{index + 1}.</div>
              <div className={styles.taskBody}>
                <div className={styles.row}>
                  <span className={styles.identifier}>{row.identifier}</span>
                  {success && (
                    <Icon icon={Check} size={14} style={{ color: cssVar.colorSuccess }} />
                  )}
                  {failedRow && <Icon icon={X} size={14} style={{ color: cssVar.colorError }} />}
                </div>
                {result?.topicId && <span className={styles.meta}>topic {result.topicId}</span>}
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
