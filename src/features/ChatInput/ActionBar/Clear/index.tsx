import { Popconfirm } from 'antd';
import { Eraser } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';
import { useFileStore } from '@/store/file';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { HotkeyEnum } from '@/types/hotkey';

import Action from '../components/Action';

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
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.ClearCurrentMessages));

  const clearCurrentMessages = useClearCurrentMessages();
  const [confirmOpened, updateConfirmOpened] = useState(false);
  const mobile = useIsMobile();

  const actionTitle: any = confirmOpened ? void 0 : t('clearCurrentMessages', { ns: 'chat' });

  const popconfirmPlacement = mobile ? 'top' : 'topRight';

  return (
    <Popconfirm
      arrow={false}
      okButtonProps={{ danger: true, type: 'primary' }}
      open={confirmOpened}
      placement={popconfirmPlacement}
      title={
        <div style={{ marginBottom: '8px', whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
          {t('confirmClearCurrentMessages', { ns: 'chat' })}
        </div>
      }
      onConfirm={clearCurrentMessages}
      onOpenChange={updateConfirmOpened}
    >
      <Action
        icon={Eraser}
        title={actionTitle}
        tooltipProps={{
          hotkey,
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
