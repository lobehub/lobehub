'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CheckCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { CompleteTodosParams, CompleteTodosState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  `,
  title: css`
    margin-inline-end: 8px;
    color: ${cssVar.colorText};
  `,
}));

export const CompleteTodosInspector = memo<
  BuiltinInspectorProps<CompleteTodosParams, CompleteTodosState>
>(({ args, partialArgs, isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  const indices = args?.indices || partialArgs?.indices || [];
  const count = indices.length;

  if (isArgumentsStreaming && count === 0) {
    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-gtd.apiName.completeTodos')}</span>
      </div>
    );
  }

  return (
    <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
      <span className={styles.title}>{t('builtins.lobe-gtd.apiName.completeTodos')}</span>
      {count > 0 && (
        <Text as={'span'} code color={cssVar.colorSuccess} fontSize={12}>
          <Icon icon={CheckCircle} size={12} />
          {count}
        </Text>
      )}
    </div>
  );
});

CompleteTodosInspector.displayName = 'CompleteTodosInspector';

export default CompleteTodosInspector;
