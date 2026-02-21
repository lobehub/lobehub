import { type UIChatMessage } from '@lobechat/types';
import { Flexbox, Modal, Segmented, Tabs } from '@lobehub/ui';
import { memo, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SharePdf from '@/features/ShareModal/SharePdf';
import { useIsMobile } from '@/hooks/useIsMobile';

import ShareImage from './ShareImage';
import ShareText from './ShareText';

enum Tab {
  PDF = 'pdf',
  Screenshot = 'screenshot',
  Text = 'text',
}

export interface ShareModalProps {
  message: UIChatMessage;
  onCancel: () => void;
  open: boolean;
}

const ShareModal = memo<ShareModalProps>(({ onCancel, open, message }) => {
  const [tab, setTab] = useState<Tab>(Tab.Screenshot);
  const { t } = useTranslation('chat');
  const uniqueId = useId();
  const isMobile = useIsMobile();

  const tabItems = useMemo(() => {
    const items = [
      {
        children: <ShareImage message={message} mobile={isMobile} uniqueId={uniqueId} />,
        key: Tab.Screenshot,
        label: t('shareModal.screenshot'),
      },
      {
        children: <ShareText item={message} />,
        key: Tab.Text,
        label: t('shareModal.text'),
      },
      {
        children: <SharePdf message={message} />,
        key: Tab.PDF,
        label: t('shareModal.pdf'),
      },
    ];

    return items;
  }, [isMobile, message, uniqueId, t]);

  return (
    <Modal
      allowFullscreen
      centered={false}
      destroyOnHidden={true}
      footer={null}
      open={open}
      title={t('share', { ns: 'common' })}
      width={1440}
      onCancel={onCancel}
    >
      <Flexbox gap={isMobile ? 8 : 24}>
        <Segmented
          block
          style={{ width: '100%' }}
          value={tab}
          variant={'filled'}
          options={tabItems.map((item) => {
            return {
              label: item?.label,
              value: item?.key,
            };
          })}
          onChange={(value) => setTab(value as Tab)}
        />
        <Tabs
          activeKey={tab}
          indicator={{ align: 'center', size: (origin) => origin - 20 }}
          items={tabItems}
          renderTabBar={() => <></>}
          onChange={(key) => setTab(key as Tab)}
        />
      </Flexbox>
    </Modal>
  );
});

export default ShareModal;
