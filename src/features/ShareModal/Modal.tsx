'use client';

import { type ConversationContext } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createModal, type ModalInstance, Tabs } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { ArticleSkeleton } from '@/components/Skeleton';
import { useIsMobile } from '@/hooks/useIsMobile';

import ShareDataProvider, { useShareData } from './ShareDataProvider';
import { loadShareTabRenderer, ShareTab, type ShareTabRenderer } from './tabRegistry';

type ShareTabRendererState =
  | { status: 'loading' }
  | { error: unknown; status: 'error'; tab: ShareTab }
  | { render: ShareTabRenderer; status: 'ready'; tab: ShareTab };

export interface OpenShareModalOptions {
  afterClose?: () => void;
  context?: Partial<ConversationContext>;
}

const ShareModalContent = memo(() => {
  const [tab, setTab] = useState<ShareTab>(ShareTab.Screenshot);
  const [rendererAttempt, setRendererAttempt] = useState(0);
  const [rendererState, setRendererState] = useState<ShareTabRendererState>({ status: 'loading' });
  const { t } = useTranslation('chat');
  const isMobile = useIsMobile();
  const { dbMessages, isLoading } = useShareData();

  useEffect(() => {
    let active = true;
    setRendererState({ status: 'loading' });

    void loadShareTabRenderer(tab).then(
      (render) => {
        if (active) setRendererState({ render, status: 'ready', tab });
      },
      (error: unknown) => {
        if (active) setRendererState({ error, status: 'error', tab });
      },
    );

    return () => {
      active = false;
    };
  }, [rendererAttempt, tab]);

  const retryRenderer = useCallback(() => setRendererAttempt((value) => value + 1), []);

  const tabItems = useMemo(
    () => [
      {
        key: ShareTab.Screenshot,
        label: t('shareModal.screenshot'),
      },
      {
        key: ShareTab.Text,
        label: t('shareModal.text'),
      },
      {
        key: ShareTab.PDF,
        label: t('shareModal.pdf'),
      },
      {
        key: ShareTab.JSON,
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
        onChange={(key) => setTab(key as ShareTab)}
      />
      {isLoading && dbMessages.length === 0 ? (
        <Flexbox gap={12} paddingBlock={8}>
          <ArticleSkeleton rows={8} />
        </Flexbox>
      ) : rendererState.status === 'error' && rendererState.tab === tab ? (
        <AsyncError error={rendererState.error} variant={'block'} onRetry={retryRenderer} />
      ) : rendererState.status === 'ready' && rendererState.tab === tab ? (
        rendererState.render({ mobile: isMobile })
      ) : (
        <Flexbox gap={12} paddingBlock={8}>
          <ArticleSkeleton rows={8} />
        </Flexbox>
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
