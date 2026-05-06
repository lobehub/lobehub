'use client';

import type { ModifyNodesArgs, ModifyOperation } from '@lobechat/editor-runtime';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, DiffIcon, Minus, Plus, X } from 'lucide-react';
import { memo } from 'react';

import type { ModifyNodesState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  index: css`
    flex-shrink: 0;

    width: 18px;

    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
    text-align: end;
  `,
  position: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px dashed ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
}));

const actionMeta = {
  insert: { color: cssVar.colorSuccess, icon: Plus },
  modify: { color: cssVar.colorWarning, icon: DiffIcon },
  remove: { color: cssVar.colorError, icon: Minus },
} as const;

const getOperationDetails = (op: ModifyOperation) => {
  switch (op.action) {
    case 'insert': {
      const position = 'afterId' in op ? `after #${op.afterId}` : `before #${op.beforeId}`;
      return { content: op.litexml, position };
    }
    case 'modify': {
      const litexml = Array.isArray(op.litexml) ? op.litexml.join('\n') : op.litexml;
      return { content: litexml };
    }
    case 'remove': {
      return { position: `#${op.id}` };
    }
  }
};

export const ModifyNodesRender = memo<BuiltinRenderProps<ModifyNodesArgs, ModifyNodesState>>(
  ({ args, pluginState }) => {
    const operations = args?.operations;
    if (!Array.isArray(operations) || operations.length === 0) return null;

    const results = pluginState?.results ?? [];

    return (
      <Block variant={'outlined'} width={'100%'}>
        {operations.map((op, index) => {
          const meta = actionMeta[op.action];
          const details = getOperationDetails(op);
          const result = results[index];
          const success = result?.success === true;
          const failed = result?.success === false;

          return (
            <div className={styles.row} key={index}>
              <span className={styles.index}>{index + 1}.</span>
              <Icon icon={meta.icon} size={14} style={{ color: meta.color, flexShrink: 0 }} />
              {details.position && <span className={styles.position}>{details.position}</span>}
              {details.content && <span className={styles.content}>{details.content}</span>}
              {success && (
                <Icon
                  icon={Check}
                  size={14}
                  style={{ color: cssVar.colorSuccess, flexShrink: 0 }}
                />
              )}
              {failed && (
                <>
                  <Icon icon={X} size={14} style={{ color: cssVar.colorError, flexShrink: 0 }} />
                  {result?.error && (
                    <Text as={'span'} fontSize={11} type={'danger'}>
                      {result.error}
                    </Text>
                  )}
                </>
              )}
            </div>
          );
        })}
      </Block>
    );
  },
);

ModifyNodesRender.displayName = 'ModifyNodesRender';

export default ModifyNodesRender;
