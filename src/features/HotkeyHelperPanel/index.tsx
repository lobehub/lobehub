'use client';

import { HotkeyGroupEnum, HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { cssVar, Grid, Icon, Tabs } from '@lobehub/ui';
import { Mail, MessageSquare, Settings2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { useGlobalStore } from '@/store/global';
import { type HotkeyGroupId } from '@/types/hotkey';

import HotkeyContent from './HotkeyContent';

const HotkeyHelperPanel = memo(() => {
  const [open, updateSystemStatus] = useGlobalStore((s) => [
    s.status.showHotkeyHelper,
    s.updateSystemStatus,
  ]);
  const [active, setActive] = useState<HotkeyGroupId>(HotkeyGroupEnum.Essential);
  const { t } = useTranslation('setting');
  const { activeScopes } = useHotkeysContext();
  // Opened on the mail page, it starts on that page's keys; the global ones are a tab away.
  const mailPage = activeScopes.includes(HotkeyScopeEnum.Mail);
  const [opened, setOpened] = useState(open);
  if (open !== opened) {
    setOpened(open);
    if (open) setActive(mailPage ? HotkeyGroupEnum.Mail : HotkeyGroupEnum.Essential);
  }

  const handleClose = () => updateSystemStatus({ showHotkeyHelper: false });

  return (
    <ImperativeModal
      centered
      footer={null}
      open={open}
      styles={{
        body: { paddingBlock: 24 },
        mask: {
          backdropFilter: 'blur(8px)',
          backgroundColor: cssVar.colorBgMask,
        },
      }}
      title={
        <Tabs
          activeKey={active}
          items={[
            {
              icon: <Icon icon={Settings2} />,
              key: HotkeyGroupEnum.Essential,
              label: t('hotkey.group.essential'),
            },
            {
              icon: <Icon icon={MessageSquare} />,
              key: HotkeyGroupEnum.Conversation,
              label: t('hotkey.group.conversation'),
            },
            {
              icon: <Icon icon={Mail} />,
              key: HotkeyGroupEnum.Mail,
              label: t('hotkey.group.mail'),
            },
          ]}
          onChange={(key) => setActive(key as HotkeyGroupId)}
        />
      }
      onCancel={handleClose}
    >
      <Grid gap={32}>
        <HotkeyContent groupId={active} />
      </Grid>
    </ImperativeModal>
  );
});

export default HotkeyHelperPanel;
