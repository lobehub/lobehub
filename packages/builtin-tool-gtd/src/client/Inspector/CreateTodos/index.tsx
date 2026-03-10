'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { oneLineEllipsis, shinyTextStyles } from '@/styles';

import type { CreateTodosParams, CreateTodosState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    margin-inline-end: 8px;
    color: ${cssVar.colorText};
  `,
}));

export const CreateTodosInspector = memo<
  BuiltinInspectorProps<CreateTodosParams, CreateTodosState>
>(({ args, partialArgs, isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  const adds = args?.adds || partialArgs?.adds || [];
  const items = args?.items || [];
  const count = adds.length || items.length;

  if (isArgumentsStreaming && count === 0) {
    return (
      <div className={cx(oneLineEllipsis, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-gtd.apiName.createTodos')}</span>
      </div>
    );
  }

  return (
    <div className={cx(oneLineEllipsis, isArgumentsStreaming && shinyTextStyles.shinyText)}>
      <span className={styles.title}>{t('builtins.lobe-gtd.apiName.createTodos')}</span>
      {count > 0 && (
        <Text code as={'span'} color={cssVar.colorSuccess} fontSize={12}>
          <Icon icon={Plus} size={12} />
          {count}
        </Text>
      )}
    </div>
  );
});

CreateTodosInspector.displayName = 'CreateTodosInspector';

export default CreateTodosInspector;
