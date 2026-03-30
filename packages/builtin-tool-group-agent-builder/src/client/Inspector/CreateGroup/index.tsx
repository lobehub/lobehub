'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { CreateGroupParams, CreateGroupState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar: cv }) => ({
  root: css`
    overflow: hidden;
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  statusIcon: css`
    flex-shrink: 0;
    margin-block-end: -2px;
  `,
  title: css`
    flex-shrink: 0;
    color: ${cv.colorTextSecondary};
    white-space: nowrap;
  `,
}));

export const CreateGroupInspector = memo<
  BuiltinInspectorProps<CreateGroupParams, CreateGroupState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const title = args?.title || partialArgs?.title;
  const avatar = args?.avatar || partialArgs?.avatar;

  if (isArgumentsStreaming && !title) {
    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-group-agent-builder.apiName.createGroup')}</span>
      </div>
    );
  }

  const isSuccess = pluginState?.success;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.root, (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}
      gap={8}
    >
      <span className={styles.title}>
        {t('builtins.lobe-group-agent-builder.apiName.createGroup')}:
      </span>
      {avatar && <Avatar avatar={avatar} shape={'square'} size={20} title={title || undefined} />}
      {title && <span>{title}</span>}
      {!isLoading && isSuccess && (
        <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
      )}
    </Flexbox>
  );
});

CreateGroupInspector.displayName = 'CreateGroupInspector';

export default CreateGroupInspector;
