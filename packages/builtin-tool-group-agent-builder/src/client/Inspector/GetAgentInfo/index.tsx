'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, cx, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyGroupStyles, shinyTextStyles } from '@/styles';

import type { GetAgentInfoParams } from '../../../types';

interface GetAgentInfoState {
  avatar?: string;
  title?: string;
}

const styles = stylex.create({
  root: { overflow: 'hidden', display: 'flex', gap: '8px', alignItems: 'center' },
  title: { flexShrink: 0, color: cssVar.colorTextSecondary, whiteSpace: 'nowrap' },
});

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
      <div {...stylex.props(styles.root)}>
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
      className={cx(stylex.props(styles.root).className, shinyGroupStyles.shinyGroup)}
      gap={8}
    >
      <span
        className={cx(
          stylex.props(styles.title).className,
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
