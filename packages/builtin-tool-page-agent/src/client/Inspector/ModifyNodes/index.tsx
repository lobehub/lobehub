'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { DiffIcon, Minus, Plus } from 'lucide-react';
import { type ReactNode, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { ModifyNodesArgs } from '@lobechat/editor-runtime';

import type { ModifyNodesState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  insert: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorSuccess};
  `,
  modify: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorWarning};
  `,
  remove: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorError};
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  `,
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
      const operations = args?.operations || partialArgs?.operations || [];
      return operations.reduce(
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
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-page-agent.apiName.modifyNodes.init')}</span>
        </div>
      );
    }

    // Build stats parts with colors and icons
    const statsParts: ReactNode[] = [];
    if (counts.insert > 0) {
      statsParts.push(
        <span className={styles.insert} key="insert">
          <Icon icon={Plus} size={12} />
          {counts.insert}
        </span>,
      );
    }
    if (counts.modify > 0) {
      statsParts.push(
        <span className={styles.modify} key="modify">
          <Icon icon={DiffIcon} size={12} />
          {counts.modify}
        </span>,
      );
    }
    if (counts.remove > 0) {
      statsParts.push(
        <span className={styles.remove} key="remove">
          <Icon icon={Minus} size={12} />
          {counts.remove}
        </span>,
      );
    }

    return (
      <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
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
