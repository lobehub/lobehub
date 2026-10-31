'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreateTaskParams, CreateTasksParams, CreateTasksState } from '../../../types';

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
  instruction: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextTertiary,
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
  title: { fontSize: '13px', lineHeight: 1.4, color: cssVar.colorText },
});

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
        <div {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.headerCount)}>
            {t('builtins.lobe-task.createTasks.count', { count: rows.length })}
          </span>
          {failedCount > 0 && (
            <span {...stylex.props(styles.failedBadge)}>
              {t('builtins.lobe-task.createTasks.failedCount', { count: failedCount })}
            </span>
          )}
        </div>
        {rows.map((task, index) => {
          const result = results[index];
          const identifier = result?.identifier;
          const failed = result && result.success === false;

          return (
            <div {...stylex.props(styles.taskItem)} key={`${identifier ?? index}-${task.name}`}>
              <div {...stylex.props(styles.index)}>{index + 1}.</div>
              <div {...stylex.props(styles.taskBody)}>
                <div {...stylex.props(styles.row)}>
                  {identifier && <span {...stylex.props(styles.identifier)}>{identifier}</span>}
                  <Text ellipsis className={stylex.props(styles.title).className}>
                    {task.name}
                  </Text>
                </div>
                {task.instruction && (
                  <div {...stylex.props(styles.instruction)}>{task.instruction}</div>
                )}
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
