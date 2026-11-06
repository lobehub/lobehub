'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, cx, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { InviteAgentParams, InviteAgentState } from '../../../types';

const styles = stylex.create({
  root: { overflow: 'hidden', display: 'flex', gap: '8px', alignItems: 'center' },
  statusIcon: { flexShrink: 0, marginBlockEnd: '-2px' },
  title: { flexShrink: 0, color: cssVar.colorTextSecondary, whiteSpace: 'nowrap' },
});

export const InviteAgentInspector = memo<
  BuiltinInspectorProps<InviteAgentParams, InviteAgentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const agentId = args?.agentId || partialArgs?.agentId;
  const displayName = pluginState?.agentName || agentId;
  const avatar = pluginState?.agentAvatar;

  // Initial streaming state
  if (isArgumentsStreaming && !agentId) {
    return (
      <div {...stylex.props(styles.root)}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-group-agent-builder.apiName.inviteAgent')}
        </span>
      </div>
    );
  }

  const isSuccess = pluginState?.success;

  return (
    <Flexbox horizontal align={'center'} className={stylex.props(styles.root).className} gap={8}>
      <span
        className={cx(
          stylex.props(styles.title).className,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        {t('builtins.lobe-group-agent-builder.apiName.inviteAgent')}:
      </span>
      {avatar && (
        <Avatar avatar={avatar} shape={'square'} size={20} title={displayName || undefined} />
      )}
      {displayName && <span>{displayName}</span>}
      {!isLoading && isSuccess && (
        <Check
          className={stylex.props(styles.statusIcon).className}
          color={cssVar.colorSuccess}
          size={14}
        />
      )}
    </Flexbox>
  );
});

InviteAgentInspector.displayName = 'InviteAgentInspector';

export default InviteAgentInspector;
