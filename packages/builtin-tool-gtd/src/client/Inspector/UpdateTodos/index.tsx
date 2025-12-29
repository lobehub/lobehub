'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { CheckCircle, DiffIcon, Minus, Plus } from 'lucide-react';
import { type ReactNode, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { UpdateTodosParams, UpdateTodosState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  add: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorSuccess};
  `,
  complete: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorPrimary};
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
  update: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorWarning};
  `,
}));

export const UpdateTodosInspector = memo<
  BuiltinInspectorProps<UpdateTodosParams, UpdateTodosState>
>(({ args, partialArgs, isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  const counts = useMemo(() => {
    const operations = args?.operations || partialArgs?.operations || [];
    return operations.reduce(
      (acc, op) => {
        switch (op.type) {
          case 'add': {
            acc.add++;
            break;
          }
          case 'update': {
            acc.update++;
            break;
          }
          case 'remove': {
            acc.remove++;
            break;
          }
          case 'complete': {
            acc.complete++;
            break;
          }
        }
        return acc;
      },
      { add: 0, complete: 0, remove: 0, update: 0 },
    );
  }, [args?.operations, partialArgs?.operations]);

  const hasOperations =
    counts.add > 0 || counts.update > 0 || counts.remove > 0 || counts.complete > 0;

  if (isArgumentsStreaming && !hasOperations) {
    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-gtd.apiName.updateTodos')}</span>
      </div>
    );
  }

  const statsParts: ReactNode[] = [];
  if (counts.add > 0) {
    statsParts.push(
      <span className={styles.add} key="add">
        <Icon icon={Plus} size={12} />
        {counts.add}
      </span>,
    );
  }
  if (counts.update > 0) {
    statsParts.push(
      <span className={styles.update} key="update">
        <Icon icon={DiffIcon} size={12} />
        {counts.update}
      </span>,
    );
  }
  if (counts.complete > 0) {
    statsParts.push(
      <span className={styles.complete} key="complete">
        <Icon icon={CheckCircle} size={12} />
        {counts.complete}
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
      <span className={styles.title}>{t('builtins.lobe-gtd.apiName.updateTodos')}</span>
      {statsParts.length > 0 && (
        <>
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
});

UpdateTodosInspector.displayName = 'UpdateTodosInspector';

export default UpdateTodosInspector;
