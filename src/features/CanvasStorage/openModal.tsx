'use client';

import { createModal, type ModalInstance } from '@lobehub/ui';
import { t } from 'i18next';

import CanvasStorageContent from './Content';

export const openCanvasStorageModal = (): ModalInstance =>
  createModal({
    content: <CanvasStorageContent />,
    footer: null,
    maskClosable: true,
    title: t('canvasStorage.title', { ns: 'file' }),
    width: 'min(92vw, 560px)',
  });
