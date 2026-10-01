import { confirmModal } from '@lobehub/ui/base-ui';
import { Eraser } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { useFileStore } from '@/store/file';

import { useChatInputResourceAccess } from '../../hooks/useChatInputResourceAccess';
import { ChatInputAction } from '../components/ChatInputAction';

export const useClearCurrentMessages = () => {
  const clearMessage = useChatStore((s) => s.clearMessage);
  const clearImageList = useFileStore((s) => s.clearChatUploadFileList);

  return useCallback(async () => {
    await clearMessage();
    clearImageList();
  }, [clearImageList, clearMessage]);
};

const Clear = memo(() => {
  const { t } = useTranslation('setting');

  const clearCurrentMessages = useClearCurrentMessages();
  const { allowed: canCreateContent } = usePermission('create_content');
  // Clearing deletes shared conversation messages — view-only members don't
  // get the confirm at all (the trigger Action is already disabled too).
  const { canUseResource } = useChatInputResourceAccess();
  const canCreate = canCreateContent && canUseResource;

  return (
    <ChatInputAction
      icon={Eraser}
      title={t('clearCurrentMessages', { ns: 'chat' })}
      tooltipProps={{
        placement: 'bottom',
        styles: {
          root: { maxWidth: 'none' },
        },
      }}
      onClick={() => {
        if (!canCreate) return;
        confirmModal({
          cancelText: t('cancel', { ns: 'common' }),
          content: (
            <div style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
              {t('confirmClearCurrentMessages', { ns: 'chat' })}
            </div>
          ),
          okButtonProps: { danger: true },
          okText: t('ok', { ns: 'common' }),
          onOk: clearCurrentMessages,
          title: t('clearCurrentMessages', { ns: 'chat' }),
        });
      }}
    />
  );
});

export default Clear;
