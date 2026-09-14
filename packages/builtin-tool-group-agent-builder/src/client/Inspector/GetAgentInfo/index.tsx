'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Avatar } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyGroupStyles, shinyTextStyles } from '@/styles';

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
      <div className={styles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-group-agent-builder.apiName.getAgentInfo')}
        </span>
      </div>
    );
  }

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.root, shinyGroupStyles.shinyGroup)}
      gap={8}
    >
      <span
        className={cx(
          styles.title,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        {t('builtins.lobe-group-agent-builder.apiName.getAgentInfo')}:
      </span>
      {avatar && <Avatar avatar={avatar} shape={'square'} size={20} title={title || undefined} />}
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {title || agentId}
      </span>
    </Flexbox>
  );
});

GetAgentInfoInspector.displayName = 'GetAgentInfoInspector';

export default GetAgentInfoInspector;
