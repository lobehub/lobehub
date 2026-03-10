import { type ModalProps } from '@lobehub/ui';
import { Flexbox, Modal, Segmented } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
    return [
      {
        label: t('shareModal.screenshot'),
        value: Tab.Screenshot,
      },
      {
        label: t('shareModal.text'),
        value: Tab.Text,
      },
      {
        label: t('shareModal.pdf'),
        value: Tab.PDF,
      },
      {
        label: 'JSON',
        value: Tab.JSON,
      },
    ];
  }, [t]);

  return (
    <Modal
      allowFullscreen
      centered
      destroyOnHidden={true}
      footer={null}
      height={'80vh'}
      open={open}
      title={t('share', { ns: 'common' })}
      width={'min(90vw, 1024px)'}
      styles={{
        body: {
          height: '80vh',
        },
      }}
      onCancel={onCancel}
    >
      <Flexbox
        gap={isMobile ? 8 : 24}
        height={'100%'}
        style={{ overflow: 'hidden', position: 'relative' }}
      >
        <Segmented
          block
          options={tabItems}
          style={{ width: '100%' }}
          value={tab}
          variant={'filled'}
          onChange={(value) => setTab(value as Tab)}
        />
        {tab === Tab.Screenshot && <ShareImage mobile={isMobile} />}
        {tab === Tab.Text && <ShareText />}
        {tab === Tab.PDF && <SharePdf />}
        {tab === Tab.JSON && <ShareJSON />}
      </Flexbox>
    </Modal>
  );
});

export default ShareModal;
