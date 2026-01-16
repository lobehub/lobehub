'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Minus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { oneLineEllipsis, shinyTextStyles } from '@/styles';

import type { RemoveTodosParams, RemoveTodosState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
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
      <div className={cx(oneLineEllipsis, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-gtd.apiName.removeTodos')}</span>
      </div>
    );
  }

  return (
    <div className={cx(oneLineEllipsis, isArgumentsStreaming && shinyTextStyles.shinyText)}>
      <span className={styles.title}>{t('builtins.lobe-gtd.apiName.removeTodos')}</span>
      {count > 0 && (
        <Text as={'span'} code color={cssVar.colorError} fontSize={12}>
          <Icon icon={Minus} size={12} />
          {count}
        </Text>
      )}
    </div>
  );
});

RemoveTodosInspector.displayName = 'RemoveTodosInspector';

export default RemoveTodosInspector;
