import { Modal, type ModalProps, Segmented, Tabs } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { isServerMode } from '@/const/version';
import { useIsMobile } from '@/hooks/useIsMobile';

import ShareImage from './ShareImage';
import ShareJSON from './ShareJSON';
import SharePdf from './SharePdf';
import ShareText from './ShareText';

enum Tab {
  JSON = 'json',
  PDF = 'pdf',
  Screenshot = 'screenshot',
  Text = 'text',
}

const ShareModal = memo<ModalProps>(({ onCancel, open }) => {
  const [tab, setTab] = useState<Tab>(Tab.Screenshot);
  const { t } = useTranslation('chat');
  const isMobile = useIsMobile();

  const tabItems = useMemo(() => {
    const items = [
      {
        children: <ShareImage mobile={isMobile} />,
        key: Tab.Screenshot,
        label: t('shareModal.screenshot'),
      },
      {
        children: <ShareText />,
        key: Tab.Text,
        label: t('shareModal.text'),
      },
      {
        children: <ShareJSON />,
        key: Tab.JSON,
        label: 'JSON',
      },
    ];

    // Only add PDF tab in server mode
    if (isServerMode) {
      items.splice(2, 0, {
        children: <SharePdf />,
        key: Tab.PDF,
        label: t('shareModal.pdf'),
      });
    }

    return items;
  }, [isMobile, t]);
  return (
    <Modal
      allowFullscreen
      centered={false}
      destroyOnHidden={true}
      footer={null}
      onCancel={onCancel}
      open={open}
      title={t('share', { ns: 'common' })}
      width={1440}
    >
      <Flexbox gap={isMobile ? 8 : 24}>
        <Segmented
          block
          onChange={(value) => setTab(value as Tab)}
          options={tabItems.map((item) => {
            return {
              label: item?.label,
              value: item?.key,
            };
          })}
          style={{ width: '100%' }}
          value={tab}
          variant={'filled'}
        />
        <Tabs
          activeKey={tab}
          indicator={{ align: 'center', size: (origin) => origin - 20 }}
          items={tabItems}
          onChange={(key) => setTab(key as Tab)}
          // eslint-disable-next-line react/jsx-no-useless-fragment
          renderTabBar={() => <></>}
        />
      </Flexbox>
    </Modal>
  );
});

export default ShareModal;
