'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { CreateTodosParams, CreateTodosState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorSuccess};
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

export const CreateTodosInspector = memo<
  BuiltinInspectorProps<CreateTodosParams, CreateTodosState>
>(({ args, partialArgs, isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  const adds = args?.adds || partialArgs?.adds || [];
  const items = args?.items || [];
  const count = adds.length || items.length;

  if (isArgumentsStreaming && count === 0) {
    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-gtd.apiName.createTodos')}</span>
      </div>
    );
  }

  return (
    <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
      <span className={styles.title}>{t('builtins.lobe-gtd.apiName.createTodos')}</span>
      {count > 0 && (
        <span className={styles.count}>
          <Icon icon={Plus} size={12} />
          {count}
        </span>
      )}
    </div>
  );
});

CreateTodosInspector.displayName = 'CreateTodosInspector';

export default CreateTodosInspector;
