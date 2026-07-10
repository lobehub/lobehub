import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Minimize2 } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';

import { useConversationStore } from '../store';
import BaseErrorForm from './BaseErrorForm';
import { useRetryParentMessage } from './useRetryParentMessage';

interface ExceededContextWindowErrorProps {
  id: string;
}

const ExceededContextWindowError = memo<ExceededContextWindowErrorProps>(({ id }) => {
  const { t } = useTranslation('error');
  const { allowed: canCreate } = usePermission('create_content');

  const context = useConversationStore((s) => s.context);
  const { disabled, loading, retryParentMessage } = useRetryParentMessage(id);

  const handleCompact = useCallback(async () => {
    if (!canCreate || !context.topicId) return;

    await retryParentMessage(() => useChatStore.getState().executeCompression(context, ''));
  }, [canCreate, context, retryParentMessage]);

  return (
    <BaseErrorForm
      avatar={<Icon icon={Minimize2} size={24} />}
      desc={t('exceededContext.desc')}
      title={t('exceededContext.title')}
      action={
        <Button
          disabled={!canCreate || !context.topicId || disabled}
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
