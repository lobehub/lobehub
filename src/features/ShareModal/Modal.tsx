'use client';

import { type ConversationContext } from '@lobechat/types';
import { type ModalInstance } from '@lobehub/ui';
import { createModal, Flexbox, Segmented, Skeleton } from '@lobehub/ui';
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
    ],
    [t],
  );

  return (
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
    afterClose,
    allowFullscreen: true,
    centered: true,
    children: (
      <ShareDataProvider context={context}>
        <ShareModalContent />
      </ShareDataProvider>
    ),
    destroyOnHidden: true,
    footer: null,
    height: '80vh',
    styles: {
      body: {
        height: '80vh',
      },
    },
    title: t('share', { ns: 'common' }),
    width: 'min(90vw, 1024px)',
  });

export default openShareModal;
