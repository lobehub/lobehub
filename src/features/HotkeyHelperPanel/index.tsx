'use client';

import { HotkeyGroupEnum } from '@lobechat/const/hotkeys';
import { Grid, Icon, Modal } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { MessageSquare, Settings2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

  const handleClose = () => updateSystemStatus({ showHotkeyHelper: false });

  return (
    <Modal
      centered
      footer={null}
      open={open}
      styles={{
        body: { paddingBlock: 24 },
        mask: {
          backdropFilter: 'blur(8px)',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
          ]}
          onChange={(key) => setActive(key as HotkeyGroupId)}
        />
      }
      onCancel={handleClose}
    >
      <Grid gap={32}>
        <HotkeyContent groupId={active} />
      </Grid>
    </Modal>
  );
});

export default HotkeyHelperPanel;
