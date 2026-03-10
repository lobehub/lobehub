'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { GetAgentInfoParams } from '../../../types';

interface GetAgentInfoState {
  avatar?: string;
  title?: string;
}

const styles = createStaticStyles(({ css, cssVar: cv }) => ({
  root: css`
    overflow: hidden;
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  title: css`
    flex-shrink: 0;
    color: ${cv.colorTextSecondary};
    white-space: nowrap;
  `,
}));

export const GetAgentInfoInspector = memo<
  BuiltinInspectorProps<GetAgentInfoParams, GetAgentInfoState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const agentId = args?.agentId || partialArgs?.agentId;
  const title = pluginState?.title;
  const avatar = pluginState?.avatar;

  // Initial streaming state
  if (isArgumentsStreaming && !agentId) {
    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-group-agent-builder.apiName.getAgentInfo')}</span>
      </div>
    );
  }

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.root, (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}
      gap={8}
    >
      <span className={styles.title}>
        {t('builtins.lobe-group-agent-builder.apiName.getAgentInfo')}:
      </span>
      {avatar && <Avatar avatar={avatar} shape={'square'} size={20} title={title || undefined} />}
      <span>{title || agentId}</span>
    </Flexbox>
  );
});

GetAgentInfoInspector.displayName = 'GetAgentInfoInspector';

export default GetAgentInfoInspector;
