'use client';

import { type ConversationContext } from '@lobechat/types';
import { createModal, cssVar, Flexbox, Icon, type ModalInstance, Tabs } from '@lobehub/ui';
import { t } from 'i18next';
import { BracesIcon, FileDownIcon, FileTextIcon, ImageIcon } from 'lucide-react';
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
        icon: isMobile ? undefined : <Icon icon={ImageIcon} size={14} />,
        key: ShareTab.Screenshot,
        label: t('shareModal.format.image'),
      },
      {
        icon: isMobile ? undefined : <Icon icon={FileTextIcon} size={14} />,
        key: ShareTab.Text,
        label: t('shareModal.format.markdown'),
      },
      {
        icon: isMobile ? undefined : <Icon icon={FileDownIcon} size={14} />,
        key: ShareTab.PDF,
        label: t('shareModal.pdf'),
      },
      {
        icon: isMobile ? undefined : <Icon icon={BracesIcon} size={14} />,
        key: ShareTab.JSON,
        label: 'JSON',
      },
    ],
    [isMobile, t],
  );

  const loadingFallback = (
    <Flexbox flex={1} gap={12} padding={24}>
      <ArticleSkeleton rows={8} />
    </Flexbox>
  );

  return (
    <Flexbox height={'100%'} style={{ overflow: 'hidden', position: 'relative' }}>
      <Tabs
        activeKey={tab}
        items={tabItems}
        size={isMobile ? 'small' : 'middle'}
        variant="square"
        styles={{
          list: {
            borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`,
            overflowX: 'auto',
            paddingInline: 12,
          },
        }}
        onChange={(key) => setTab(key as ShareTab)}
      />
      {isLoading && dbMessages.length === 0 ? (
        loadingFallback
      ) : rendererState.status === 'error' && rendererState.tab === tab ? (
        <Flexbox padding={24}>
          <AsyncError error={rendererState.error} variant={'block'} onRetry={retryRenderer} />
        </Flexbox>
      ) : rendererState.status === 'ready' && rendererState.tab === tab ? (
        rendererState.render({ mobile: isMobile })
      ) : (
        loadingFallback
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
      content: { display: 'flex', flexDirection: 'column', height: 'min(80vh, 760px)', padding: 0 },
    },
    title: t('shareModal.title', { ns: 'chat' }),
    width: 'min(90vw, 1024px)',
  });

export default openShareModal;
