import { type UIChatMessage } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { memo, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import ShareDataProvider from '@/features/ShareModal/ShareDataProvider';
import SharePdf from '@/features/ShareModal/SharePdf';
import { useIsMobile } from '@/hooks/useIsMobile';

import { useConversationStore } from '../../store';
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
  const context = useConversationStore((s) => s.context);

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
        children: (
          <ShareDataProvider context={context}>
            <SharePdf message={message} />
          </ShareDataProvider>
        ),
        key: Tab.PDF,
        label: t('shareModal.pdf'),
      },
    ];

    return items;
  }, [context, isMobile, message, uniqueId, t]);

  return (
    <ImperativeModal
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
        <Tabs
          activeKey={tab}
          items={tabItems}
          styles={{
            list: { display: 'flex', width: '100%' },
            tab: { flex: 1 },
          }}
          onChange={(key) => setTab(key as Tab)}
        />
      </Flexbox>
    </ImperativeModal>
  );
});

export default ShareModal;
