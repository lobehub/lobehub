import { Icon } from '@lobehub/ui';
import { Button } from 'antd';
import { Minimize2 } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { useConversationStore } from '../store';
import BaseErrorForm from './BaseErrorForm';

interface ExceededContextWindowErrorProps {
  id: string;
}

const ExceededContextWindowError = memo<ExceededContextWindowErrorProps>(({ id }) => {
  const { t } = useTranslation('error');
  const [loading, setLoading] = useState(false);

  const [deleteMessage, regenerateAssistantMessage] = useConversationStore((s) => [
    s.deleteMessage,
    s.regenerateAssistantMessage,
  ]);

  const topicId = useChatStore((s) => s.activeTopicId);

  const handleCompact = useCallback(async () => {
    if (!topicId) return;

    setLoading(true);
    try {
      const chatState = useChatStore.getState();
      const context = {
        agentId: chatState.activeAgentId,
        groupId: chatState.activeGroupId,
        topicId,
      };

      // Delete the error message first (optimistic update removes it from UI immediately)
      await deleteMessage(id);
      await chatState.executeCompression(context, '');
      await regenerateAssistantMessage(id);
    } finally {
      setLoading(false);
    }
  }, [deleteMessage, id, regenerateAssistantMessage, topicId]);

  return (
    <BaseErrorForm
      avatar={<Icon icon={Minimize2} size={{ fontSize: 24 }} />}
      desc={t('exceededContext.desc')}
      title={t('exceededContext.title')}
      action={
        <Button disabled={!topicId} loading={loading} type={'primary'} onClick={handleCompact}>
          {t('exceededContext.compact')}
        </Button>
      }
    />
  );
});

export default ExceededContextWindowError;
