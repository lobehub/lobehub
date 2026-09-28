'use client';

import { createModal } from '@lobehub/ui/base-ui';

import ShareVisitorDocumentContent, { type ShareVisitorDocumentContentProps } from './Content';

export const createShareVisitorDocumentModal = (
  params: ShareVisitorDocumentContentProps & { title: string },
) =>
  createModal({
    content: <ShareVisitorDocumentContent {...params} />,
    footer: null,
    maskClosable: true,
    styles: { content: { maxHeight: '70vh', overflow: 'auto' } },
    title: params.title,
    width: 'min(90%, 800px)',
  });
