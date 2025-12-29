'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Minus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { RemoveTodosParams, RemoveTodosState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorError};
  `,
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

export const RemoveTodosInspector = memo<
  BuiltinInspectorProps<RemoveTodosParams, RemoveTodosState>
>(({ args, partialArgs, isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  const indices = args?.indices || partialArgs?.indices || [];
  const count = indices.length;

  if (isArgumentsStreaming && count === 0) {
    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-gtd.apiName.removeTodos')}</span>
      </div>
    );
  }

  return (
    <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
      <span className={styles.title}>{t('builtins.lobe-gtd.apiName.removeTodos')}</span>
      {count > 0 && (
        <span className={styles.count}>
          <Icon icon={Minus} size={12} />
          {count}
        </span>
      )}
    </div>
  );
});

RemoveTodosInspector.displayName = 'RemoveTodosInspector';

export default RemoveTodosInspector;
