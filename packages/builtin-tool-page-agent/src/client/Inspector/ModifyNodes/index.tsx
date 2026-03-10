'use client';

import type { ModifyNodesArgs } from '@lobechat/editor-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { DiffIcon, Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { oneLineEllipsis, shinyTextStyles } from '@/styles';

import type { ModifyNodesState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  separator: css`
    margin-inline: 2px;
    color: ${cssVar.colorTextQuaternary};
  `,
  title: css`
    margin-inline-end: 8px;
    color: ${cssVar.colorText};
  `,
}));

export const ModifyNodesInspector = memo<BuiltinInspectorProps<ModifyNodesArgs, ModifyNodesState>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    // Count operations by type
    const counts = useMemo(() => {
      const ops = args?.operations || partialArgs?.operations;
      // During streaming, operations may be a partial object instead of array
      if (!Array.isArray(ops)) return { insert: 0, modify: 0, remove: 0 };

      return ops.reduce(
        (acc, op) => {
          switch (op.action) {
            case 'insert': {
              acc.insert++;
              break;
            }
            case 'modify': {
              acc.modify++;
              break;
            }
            case 'remove': {
              {
                acc.remove++;
                // No default
              }
              break;
            }
          }
          return acc;
        },
        { insert: 0, modify: 0, remove: 0 },
      );
    }, [args?.operations, partialArgs?.operations]);

    const hasOperations = counts.insert > 0 || counts.modify > 0 || counts.remove > 0;

    // During streaming without operations yet, show init message
    if (isArgumentsStreaming && !hasOperations) {
      return (
        <div className={cx(oneLineEllipsis, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-page-agent.apiName.modifyNodes.init')}</span>
        </div>
      );
    }

    // Build stats parts with colors and icons
    const statsParts: ReactNode[] = [];
    if (counts.insert > 0) {
      statsParts.push(
        <Text code as={'span'} color={cssVar.colorSuccess} fontSize={12} key="insert">
          <Icon icon={Plus} size={12} />
          {counts.insert}
        </Text>,
      );
    }
    if (counts.modify > 0) {
      statsParts.push(
        <Text code as={'span'} color={cssVar.colorWarning} fontSize={12} key="modify">
          <Icon icon={DiffIcon} size={12} />
          {counts.modify}
        </Text>,
      );
    }
    if (counts.remove > 0) {
      statsParts.push(
        <Text code as={'span'} color={cssVar.colorError} fontSize={12} key="remove">
          <Icon icon={Minus} size={12} />
          {counts.remove}
        </Text>,
      );
    }

    return (
      <div className={cx(oneLineEllipsis, isArgumentsStreaming && shinyTextStyles.shinyText)}>
        <span className={styles.title}>{t('builtins.lobe-page-agent.apiName.modifyNodes')}</span>
        {statsParts.length > 0 && (
          <>
            {' '}
            {statsParts.map((part, index) => (
              <span key={index}>
                {index > 0 && <span className={styles.separator}> / </span>}
                {part}
              </span>
            ))}
          </>
        )}
      </div>
    );
  },
);

ModifyNodesInspector.displayName = 'ModifyNodesInspector';

export default ModifyNodesInspector;
