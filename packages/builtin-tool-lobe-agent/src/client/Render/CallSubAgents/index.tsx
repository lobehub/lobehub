'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Button, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ListTree } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { portalThreadSelectors, threadSelectors } from '@/store/chat/selectors';

import type { CallSubAgentsParams, CallSubAgentsState, SubAgentRunStats } from '../../../types';
import { SubAgentStats } from '../../components/SubAgentStats';

const styles = createStaticStyles(({ css, cssVar }) => ({
  index: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  openThread: css`
    height: 22px;
    padding-inline: 6px;
    font-size: 12px;
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px dashed ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  title: css`
    overflow: hidden;

    font-size: 13px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface SubAgentRowProps extends SubAgentRunStats {
  description: string;
  index: number;
  threadId: string;
}

const SubAgentRow = memo<SubAgentRowProps>(
  ({ description, index, threadId, model, totalToolCalls, totalTokens }) => {
    const { t: tChat } = useTranslation('chat');

    const subagentThread = useChatStore((s) =>
      threadId
        ? (threadSelectors.currentTopicThreads(s) ?? []).find((thread) => thread.id === threadId)
        : undefined,
    );
    const openThreadInPortal = useChatStore((s) => s.openThreadInPortal);
    const closeThreadPortal = useChatStore((s) => s.closeThreadPortal);
    const portalThreadId = useChatStore(portalThreadSelectors.portalThreadId);
    const isOpenInPortal = !!subagentThread && portalThreadId === subagentThread.id;

    const handleToggleThread = useCallback(() => {
      if (!subagentThread) return;
      if (isOpenInPortal) {
        closeThreadPortal();
      } else {
        openThreadInPortal(subagentThread.id, subagentThread.sourceMessageId);
      }
    }, [subagentThread, isOpenInPortal, openThreadInPortal, closeThreadPortal]);

    return (
      <div className={styles.row}>
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
          <span className={styles.index}>{index + 1}.</span>
          <span className={styles.title}>{description}</span>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={12} style={{ flexShrink: 0 }}>
          <SubAgentStats model={model} totalTokens={totalTokens} totalToolCalls={totalToolCalls} />
          {subagentThread && (
            <Button
              className={styles.openThread}
              icon={ListTree}
              size={'small'}
              type={'text'}
              onClick={handleToggleThread}
            >
              {isOpenInPortal
                ? tChat('thread.closeSubagentThread')
                : tChat('thread.openSubagentThread')}
            </Button>
          )}
        </Flexbox>
      </div>
    );
  },
);

SubAgentRow.displayName = 'CallSubAgentsRow';

export const CallSubAgentsRender = memo<
  BuiltinRenderProps<CallSubAgentsParams, CallSubAgentsState>
>(({ pluginState }) => {
  const subAgents = pluginState?.subAgents;

  if (!subAgents || subAgents.length === 0) return null;

  return (
    <Block variant={'outlined'} width="100%">
      {subAgents.map((subAgent, index) => (
        <SubAgentRow
          description={subAgent.description}
          index={index}
          key={subAgent.threadId || index}
          model={subAgent.model}
          threadId={subAgent.threadId}
          totalTokens={subAgent.totalTokens}
          totalToolCalls={subAgent.totalToolCalls}
        />
      ))}
    </Block>
  );
});

CallSubAgentsRender.displayName = 'CallSubAgentsRender';

export default CallSubAgentsRender;
