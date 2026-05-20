'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import CompareContent, { type CompareContentProps } from './CompareContent';

export type OpenDocumentCompareModalProps = CompareContentProps;

export const openDocumentCompareModal = (props: OpenDocumentCompareModalProps): ModalInstance =>
  createModal({
    content: <CompareContent {...props} />,
    footer: null,
    styles: {
      content: {
        display: 'flex',
        height: 'min(72vh, 800px)',
        overflow: 'hidden',
        padding: 0,
      },
    },
    title: t('pageEditor.history.compareTitle', { ns: 'file' }),
    width: 'min(92vw, 1200px)',
  });
