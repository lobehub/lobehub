import { App, Button, Checkbox } from 'antd';
import { Eraser } from 'lucide-react';
import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

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
  const settings = useUserStore(settingsSelectors.currentSettings);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);

  const clearCurrentMessages = useClearCurrentMessages();
  const { modal } = App.useApp();

  // Use ref to track checkbox state in modal
  const deleteFilesRef = useRef(settings.general?.deleteTopicFiles || false);

  const handleClick = useCallback(() => {
    // Reset ref to current setting value when opening modal
    deleteFilesRef.current = settings.general?.deleteTopicFiles || false;

    const { destroy } = modal.confirm({
      centered: true,
      footer: (
        <Flexbox align="center" horizontal justify="space-between" style={{ marginTop: 24 }}>
          <Checkbox
            defaultChecked={deleteFilesRef.current}
            onChange={(e) => {
              deleteFilesRef.current = e.target.checked;
              updateGeneralConfig({ deleteTopicFiles: e.target.checked });
            }}
          >
            {t('actions.deleteTopicFiles', { ns: 'topic' })}
          </Checkbox>
          <Flexbox gap={8} horizontal>
            <Button onClick={() => destroy()}>{t('cancel', { ns: 'common' })}</Button>
            <Button
              danger
              onClick={async () => {
                await clearCurrentMessages();
                destroy();
              }}
              type="primary"
            >
              {t('ok', { ns: 'common' })}
            </Button>
          </Flexbox>
        </Flexbox>
      ),
      maskClosable: true,
      title: t('confirmClearCurrentMessages', { ns: 'chat' }),
    });
  }, [clearCurrentMessages, modal, settings.general?.deleteTopicFiles, t, updateGeneralConfig]);

  const actionTitle = t('clearCurrentMessages', { ns: 'chat' });

  return (
    <Action
      icon={Eraser}
      onClick={handleClick}
      title={actionTitle}
      tooltipProps={{
        hotkey,
        placement: 'bottom',
        styles: {
          root: { maxWidth: 'none' },
        },
      }}
    />
  );
});

export default Clear;
