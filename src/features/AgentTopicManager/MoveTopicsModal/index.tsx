'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import MoveTopicsContent, { type MoveTopicsContentProps } from './Content';

export const createMoveTopicsModal = (props: MoveTopicsContentProps): ModalInstance =>
  createModal({
    content: <MoveTopicsContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { overflow: 'hidden', padding: 0 },
    },
    title: t('management.moveModal.title', { ns: 'topic' }),
    width: 'min(90%, 420px)',
  });
