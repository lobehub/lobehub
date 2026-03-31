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

  const context = useConversationStore((s) => s.context);
  const regenerateUserMessage = useConversationStore((s) => s.regenerateUserMessage);
  const parentId = useConversationStore(
    (s) => s.displayMessages.find((m) => m.id === id)?.parentId,
  );

  const handleCompact = useCallback(async () => {
    if (!context.topicId || !parentId) return;

    setLoading(true);
    try {
      await useChatStore.getState().executeCompression(context, '');
      await regenerateUserMessage(parentId);
    } finally {
      setLoading(false);
    }
  }, [context, parentId, regenerateUserMessage]);

  return (
    <BaseErrorForm
      avatar={<Icon icon={Minimize2} size={24} />}
      desc={t('exceededContext.desc')}
      title={t('exceededContext.title')}
      action={
        <Button
          disabled={!context.topicId}
          loading={loading}
          type={'primary'}
          onClick={handleCompact}
        >
          {t('exceededContext.compact')}
        </Button>
      }
    />
  );
});

export default ExceededContextWindowError;
