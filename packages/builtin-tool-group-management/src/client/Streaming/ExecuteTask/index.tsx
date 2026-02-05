'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import type { BuiltinStreamingProps } from '@lobechat/types';
import { Avatar, Flexbox, Markdown } from '@lobehub/ui';
import { createStaticStyles, useTheme } from 'antd-style';
import { memo } from 'react';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import type { ExecuteTaskParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  agentTitle: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  container: css`
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
  task: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

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
    <div className={styles.container}>
      <Flexbox gap={8}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Avatar
            avatar={agent?.avatar || DEFAULT_AVATAR}
            background={agent?.backgroundColor || theme.colorBgContainer}
            shape={'square'}
            size={24}
          />
          <span className={styles.agentTitle}>{agent?.title || 'Agent'}</span>
        </Flexbox>
        <div className={styles.task}>
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
