import { Popconfirm } from 'antd';
import { Eraser } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
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
  const [confirmOpened, updateConfirmOpened] = useState(false);
  const mobile = useIsMobile();
  const { allowed: canCreateContent } = usePermission('create_content');
  // Clearing deletes shared conversation messages — view-only members don't
  // get the confirm at all (the trigger Action is already disabled too).
  const { canUseResource } = useChatInputResourceAccess();
  const canCreate = canCreateContent && canUseResource;

  const actionTitle: any = confirmOpened ? void 0 : t('clearCurrentMessages', { ns: 'chat' });

  const popconfirmPlacement = mobile ? 'top' : 'topRight';

  return (
    <Popconfirm
      arrow={false}
      okButtonProps={{ danger: true, disabled: !canCreate, type: 'primary' }}
      open={confirmOpened}
      placement={popconfirmPlacement}
      title={
        <div style={{ marginBottom: '8px', whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
          {t('confirmClearCurrentMessages', { ns: 'chat' })}
        </div>
      }
      onConfirm={() => {
        if (!canCreate) return;
        clearCurrentMessages();
      }}
      onOpenChange={(open) => {
        if (!canCreate && open) return;
        updateConfirmOpened(open);
      }}
    >
      <ChatInputAction
        icon={Eraser}
        title={actionTitle}
        tooltipProps={{
          placement: 'bottom',
          styles: {
            root: { maxWidth: 'none' },
          },
        }}
      />
    </Popconfirm>
  );
});

export default Clear;
