'use client';

import type { MessageSubAgentCallback } from '@lobechat/types';
import { Button, Flexbox, Tag } from '@lobehub/ui';
import { ListTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors, threadSelectors } from '@/store/chat/selectors';

/**
 * Who a background sub-agent's report reads as: the answering agent's avatar
 * (the parent itself for an anonymous `callSubAgent` clone) under the call's
 * name, falling back to the agent's own title.
 */
export const useSubAgentSenderIdentity = (
  callback: MessageSubAgentCallback | undefined,
): { avatar?: string; title: string } | undefined => {
  const agentId = callback?.agentId;
  // Primitive selections: the meta selector builds a new object per call.
  const avatar = useAgentStore((s) =>
    agentId ? agentSelectors.getAgentMetaById(agentId)(s).avatar : undefined,
  );
  const agentTitle = useAgentStore((s) =>
    agentId ? agentSelectors.getAgentMetaById(agentId)(s).title : undefined,
  );

  if (!callback) return undefined;
  return { avatar, title: callback.name || agentTitle || '' };
};

/** Header addons of a sub-agent's report: the sub-agent tag and its outcome. */
export const SubAgentSenderTags = ({ callback }: { callback: MessageSubAgentCallback }) => {
  const { t } = useTranslation('chat');

  return (
    <>
      <Tag size={'small'}>{t('subAgentCallback.tag')}</Tag>
      {callback.status === 'error' && (
        <Tag color={'error'} size={'small'}>
          {t('subAgentCallback.failed')}
        </Tag>
      )}
    </>
  );
};

/** Under a sub-agent's report: the way into its thread, once the thread is listed. */
export const SubAgentThreadLink = ({ callback }: { callback: MessageSubAgentCallback }) => {
  const { t } = useTranslation('chat');

  const thread = useChatStore((s) =>
    (threadSelectors.currentTopicThreads(s) ?? []).find(
      (candidate) => candidate.id === callback.threadId,
    ),
  );
  const openThreadInPortal = useChatStore((s) => s.openThreadInPortal);
  const closeThreadPortal = useChatStore((s) => s.closeThreadPortal);
  const isOpenInPortal = useChatStore(
    (s) => !!thread && portalThreadSelectors.portalThreadId(s) === thread.id,
  );

  if (!thread) return null;

  return (
    <Flexbox horizontal justify={'flex-end'}>
      <Button
        icon={ListTree}
        size={'small'}
        type={'text'}
        onClick={() =>
          isOpenInPortal
            ? closeThreadPortal()
            : openThreadInPortal(thread.id, thread.sourceMessageId)
        }
      >
        {isOpenInPortal ? t('thread.closeSubagentThread') : t('thread.openSubagentThread')}
      </Button>
    </Flexbox>
  );
};
