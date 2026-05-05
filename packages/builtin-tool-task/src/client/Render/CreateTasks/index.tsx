'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreateTaskParams, CreateTasksParams, CreateTasksState } from '../../../types';

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
  instruction: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
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
  title: css`
    font-size: 13px;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

export const CreateTasksRender = memo<BuiltinRenderProps<CreateTasksParams, CreateTasksState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('plugin');

    const items: CreateTaskParams[] = args?.tasks ?? [];
    const results = pluginState?.results ?? [];

    if (items.length === 0 && results.length === 0) return null;

    const rows = items.length > 0 ? items : results.map((r) => ({ instruction: '', name: r.name }));
    const failedCount = pluginState?.failed ?? results.filter((r) => !r.success).length;

    return (
      <Block variant={'outlined'} width={'100%'}>
        <div className={styles.header}>
          <span className={styles.headerCount}>
            {t('builtins.lobe-task.createTasks.count', { count: rows.length })}
          </span>
          {failedCount > 0 && (
            <span className={styles.failedBadge}>
              {t('builtins.lobe-task.createTasks.failedCount', { count: failedCount })}
            </span>
          )}
        </div>
        {rows.map((task, index) => {
          const result = results[index];
          const identifier = result?.identifier;
          const failed = result && result.success === false;

          return (
            <div className={styles.taskItem} key={`${identifier ?? index}-${task.name}`}>
              <div className={styles.index}>{index + 1}.</div>
              <div className={styles.taskBody}>
                <div className={styles.row}>
                  {identifier && <span className={styles.identifier}>{identifier}</span>}
                  <Text ellipsis className={styles.title}>
                    {task.name}
                  </Text>
                </div>
                {task.instruction && <div className={styles.instruction}>{task.instruction}</div>}
                {failed && (
                  <Text as={'span'} fontSize={11} type={'danger'}>
                    {result?.error ?? 'Failed'}
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

CreateTasksRender.displayName = 'CreateTasksRender';

export default CreateTasksRender;
