'use client';

import { type ConversationContext } from '@lobechat/types';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { createModal, type ModalInstance, Tabs } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';

import ShareDataProvider, { useShareData } from './ShareDataProvider';
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

export interface OpenShareModalOptions {
  afterClose?: () => void;
  context?: Partial<ConversationContext>;
}

const ShareModalContent = memo(() => {
  const [tab, setTab] = useState<Tab>(Tab.Screenshot);
  const { t } = useTranslation('chat');
  const isMobile = useIsMobile();
  const { dbMessages, isLoading } = useShareData();

  const tabItems = useMemo(
    () => [
      {
        key: Tab.Screenshot,
        label: t('shareModal.screenshot'),
      },
      {
        key: Tab.Text,
        label: t('shareModal.text'),
      },
      {
        key: Tab.PDF,
        label: t('shareModal.pdf'),
      },
      {
        key: Tab.JSON,
        label: 'JSON',
      },
    ],
    [t],
  );

  return (
    <Flexbox
      gap={isMobile ? 8 : 24}
      height={'100%'}
      style={{ overflow: 'hidden', position: 'relative' }}
    >
      <Tabs
        activeKey={tab}
        items={tabItems}
        variant="rounded"
        styles={{
          list: { display: 'flex', width: '100%' },
          tab: { flex: 1 },
        }}
        onChange={(key) => setTab(key as Tab)}
      />
      {isLoading && dbMessages.length === 0 ? (
        <Flexbox gap={12} paddingBlock={8}>
          <Skeleton active paragraph={{ rows: 8 }} />
        </Flexbox>
      ) : (
        <>
          {tab === Tab.Screenshot && <ShareImage mobile={isMobile} />}
          {tab === Tab.Text && <ShareText />}
          {tab === Tab.PDF && <SharePdf />}
          {tab === Tab.JSON && <ShareJSON />}
        </>
      )}
    </Flexbox>
  );
});

ShareModalContent.displayName = 'ShareModalContent';

export const openShareModal = ({
  afterClose,
  context,
}: OpenShareModalOptions = {}): ModalInstance =>
  createModal({
    content: (
      <ShareDataProvider context={context}>
        <ShareModalContent />
      </ShareDataProvider>
    ),
    footer: null,
    maskClosable: true,
    onOpenChangeComplete: (open) => {
      if (!open) afterClose?.();
    },
    styles: {
      content: { height: 'min(80vh, 800px)' },
    },
    title: t('shareModal.title', { ns: 'chat' }),
    width: 'min(90vw, 1024px)',
  });

export default openShareModal;
