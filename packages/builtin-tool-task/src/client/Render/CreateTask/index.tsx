'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import type { CreateTaskParams, CreateTaskState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
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
  instruction: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  taskItem: css`
    display: flex;
    flex-direction: column;
    gap: 6px;

    padding-block: 10px;
    padding-inline: 12px;
  `,
  title: css`
    font-size: 13px;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

export const CreateTaskRender = memo<BuiltinRenderProps<CreateTaskParams, CreateTaskState>>(
  ({ args, pluginState }) => {
    if (!args?.name && !pluginState?.identifier) return null;

    const identifier = pluginState?.identifier;
    const name = args?.name;
    const instruction = args?.instruction;
    const parent = args?.parentIdentifier;

    return (
      <Block variant={'outlined'} width={'100%'}>
        <div className={styles.taskItem}>
          <div className={styles.row}>
            {identifier && <span className={styles.identifier}>{identifier}</span>}
            {name && <Text className={styles.title}>{name}</Text>}
          </div>
          {instruction && <div className={styles.instruction}>{instruction}</div>}
          {parent && (
            <Text as={'span'} color={cssVar.colorTextTertiary} fontSize={11}>
              {`Subtask of ${parent}`}
            </Text>
          )}
        </div>
      </Block>
    );
  },
);

CreateTaskRender.displayName = 'CreateTaskRender';

export default CreateTaskRender;
