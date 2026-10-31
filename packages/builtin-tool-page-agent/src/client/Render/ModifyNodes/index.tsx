'use client';

import type { ModifyNodesArgs, ModifyOperation } from '@lobechat/editor-runtime';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, DiffIcon, Minus, Plus, X } from 'lucide-react';
import { memo } from 'react';

import type { ModifyNodesState } from '../../../types';

const styles = stylex.create({
  content: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  index: {
    flexShrink: 0,
    width: '18px',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
    textAlign: 'end',
  },
  position: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillTertiary,
  },
  row: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'dashed', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

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
            <div {...stylex.props(styles.row)} key={index}>
              <span {...stylex.props(styles.index)}>{index + 1}.</span>
              <Icon icon={meta.icon} size={14} style={{ color: meta.color, flexShrink: 0 }} />
              {details.position && (
                <span {...stylex.props(styles.position)}>{details.position}</span>
              )}
              {details.content && <span {...stylex.props(styles.content)}>{details.content}</span>}
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
