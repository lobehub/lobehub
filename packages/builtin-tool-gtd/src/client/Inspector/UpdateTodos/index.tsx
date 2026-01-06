'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CheckCircle, DiffIcon, Minus, Plus } from 'lucide-react';
import { type ReactNode, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { UpdateTodosParams, UpdateTodosState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
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
      <Text as={'span'} code color={cssVar.colorSuccess} fontSize={12} key="add">
        <Icon icon={Plus} size={12} />
        {counts.add}
      </Text>,
    );
  }
  if (counts.update > 0) {
    statsParts.push(
      <Text as={'span'} code color={cssVar.colorWarning} fontSize={12} key="update">
        <Icon icon={DiffIcon} size={12} />
        {counts.update}
      </Text>,
    );
  }
  if (counts.complete > 0) {
    statsParts.push(
      <Text as={'span'} code color={cssVar.colorPrimary} fontSize={12} key="complete">
        <Icon icon={CheckCircle} size={12} />
        {counts.complete}
      </Text>,
    );
  }
  if (counts.remove > 0) {
    statsParts.push(
      <Text as={'span'} code color={cssVar.colorError} fontSize={12} key="remove">
        <Icon icon={Minus} size={12} />
        {counts.remove}
      </Text>,
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
