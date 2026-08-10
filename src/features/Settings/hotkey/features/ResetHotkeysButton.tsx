'use client';

import { DEFAULT_HOTKEY_CONFIG } from '@lobechat/const';
import { Icon } from '@lobehub/ui';
import { Button, confirmModal, toast } from '@lobehub/ui/base-ui';
import { RotateCcw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';

import { resetDesktopHotkeys } from './resetHotkeys';

export const ResetHotkeysButton = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const setSettings = useUserStore((s) => s.setSettings);
  const updateDesktopHotkey = useElectronStore((s) => s.updateDesktopHotkey);

  const resetHotkeys = async () => {
    try {
      if (isDesktop) {
        const result = await resetDesktopHotkeys(updateDesktopHotkey);
        if (!result.success) {
          toast.error(t(`hotkey.errors.${result.errorType || 'UNKNOWN'}` as any));
          return;
        }
      }

      await setSettings({ hotkey: DEFAULT_HOTKEY_CONFIG });
      toast.success(t('hotkey.resetSuccess'));
    } catch {
      toast.error(t('hotkey.updateError'));
    }
  };

  return (
    <Button
      icon={<Icon icon={RotateCcw} />}
      size={'small'}
      onClick={() =>
        confirmModal({
          cancelText: t('cancel', { ns: 'common' }),
          content: t('hotkey.resetConfirm'),
          okText: t('hotkey.reset'),
          onOk: resetHotkeys,
          title: t('hotkey.reset'),
        })
      }
    >
      {t('hotkey.reset')}
    </Button>
  );
});

ResetHotkeysButton.displayName = 'ResetHotkeysButton';
