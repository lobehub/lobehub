import { Button, CopyButton, Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { NoticeAlert } from '@/components/NoticeAlert';
import { useConversationStore } from '@/features/Conversation/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useFailedSendDrafts } from './useFailedSendDrafts';

export const FailedSendDrafts = () => {
  const { t } = useTranslation('chat');
  const contextKey = useConversationStore((s) => messageMapKey(s.context));
  const { drafts, restore } = useFailedSendDrafts(contextKey);

  if (!drafts.length) return null;
  return (
    <Flexbox gap={8} paddingBlock={8}>
      {drafts.map((draft) => (
        <NoticeAlert
          key={draft.id}
          title={t('input.failedSend.title')}
          type={'secondary'}
          action={
            <Flexbox horizontal align={'center'} gap={4}>
              <CopyButton content={draft.message} title={t('input.failedSend.copy')} />
              <Button size={'small'} onClick={() => restore(draft)}>
                {t('input.failedSend.restore')}
              </Button>
            </Flexbox>
          }
          description={
            <Flexbox gap={4}>
              <span style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                {draft.message || t('input.failedSend.attachments')}
              </span>
              <span>{t('input.failedSend.hint')}</span>
            </Flexbox>
          }
        />
      ))}
    </Flexbox>
  );
};
