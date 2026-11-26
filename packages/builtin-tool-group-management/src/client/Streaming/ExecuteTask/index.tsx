'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Flexbox, Markdown, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import type { ExecuteTaskParams } from '../../../types';

const styles = stylex.create({
  agentTitle: { fontSize: '14px', fontWeight: 500, color: cssVar.colorText },
  container: {
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  task: { fontSize: '13px', color: cssVar.colorTextSecondary },
});

export const ExecuteTaskStreaming = memo<BuiltinStreamingProps<ExecuteTaskParams>>(({ args }) => {
  const { agentId, instruction } = args || {};
  const theme = useTheme();

  // Get active group ID and agent from store
  const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const agent = useAgentGroupStore((s) =>
    activeGroupId && agentId
      ? agentGroupSelectors.getAgentByIdFromGroup(activeGroupId, agentId)(s)
      : undefined,
  );

  if (!instruction) return null;

  return (
    <div {...stylex.props(styles.container)}>
      <Flexbox gap={8}>
        <Flexbox horizontal align={'center'} gap={8}>
          <AgentAvatar
            agentId={agentId}
            avatar={agent?.avatar}
            background={agent?.backgroundColor || theme.colorBgContainer}
            name={agent?.title}
            shape={'square'}
            size={24}
          />
          <span {...stylex.props(styles.agentTitle)}>{agent?.title || 'Agent'}</span>
        </Flexbox>
        <div {...stylex.props(styles.task)}>
          <Markdown animated variant={'chat'}>
            {instruction}
          </Markdown>
        </div>
      </Flexbox>
    </div>
  );
});

ExecuteTaskStreaming.displayName = 'ExecuteTaskStreaming';

export default ExecuteTaskStreaming;
