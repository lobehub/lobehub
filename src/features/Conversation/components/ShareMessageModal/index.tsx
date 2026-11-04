import { type UIChatMessage } from '@lobechat/types';
import { createModal } from '@lobehub/ui';
import { t } from 'i18next';
import { lazy, Suspense } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';
import ContentLoading from '@/components/Loading/ContentLoading';
import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

import type { createStore } from '../../store';

// The modal renders a message as an image, text and PDF, so the screenshot
// library and pdf.js come with it. Every surface that lists messages reaches
// this entry through its action bar; the modal opens on click and its content
// loads inside it.
const ShareMessageModal = lazy(() => import('./Content'));

const handleContentError = (error: unknown) => {
  if (isChunkLoadError(error)) notifyChunkError(error);
};

export const openShareMessageModal = (
  message: UIChatMessage,
  createConversationStore: () => ReturnType<typeof createStore>,
) =>
  createModal({
    content: (
      <SafeBoundary variant="alert" onError={handleContentError}>
        <Suspense fallback={<ContentLoading />}>
          <ShareMessageModal createConversationStore={createConversationStore} message={message} />
        </Suspense>
      </SafeBoundary>
    ),
    footer: null,
    maskClosable: true,
    title: t('share', { ns: 'common' }),
    width: 'min(95vw, 1440px)',
  });
