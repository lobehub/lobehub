import { type UIChatMessage } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createModal, Tabs } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { memo, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ShareDataProvider from '@/features/ShareModal/ShareDataProvider';
import SharePdf from '@/features/ShareModal/SharePdf';
import { useIsMobile } from '@/hooks/useIsMobile';

import type { createStore } from '../../store';
import { Provider, useConversationStore } from '../../store';
import ShareImage from './ShareImage';
import ShareText from './ShareText';

enum Tab {
  PDF = 'pdf',
  Screenshot = 'screenshot',
  Text = 'text',
}

interface ShareMessageModalContentProps {
  message: UIChatMessage;
}

const ShareMessageModalContent = memo<ShareMessageModalContentProps>(({ message }) => {
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
  );
});

ShareMessageModalContent.displayName = 'ShareMessageModalContent';

export const openShareMessageModal = (
  message: UIChatMessage,
  createConversationStore: () => ReturnType<typeof createStore>,
) =>
  createModal({
    content: (
      <Provider createStore={createConversationStore}>
        <ShareMessageModalContent message={message} />
      </Provider>
    ),
    footer: null,
    maskClosable: true,
    title: t('share', { ns: 'common' }),
    width: 'min(95vw, 1440px)',
  });
