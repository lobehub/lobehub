'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import RunEditContent, { type RunEditContentProps } from './Content';

export const createRunEditModal = (props: RunEditContentProps): ModalInstance =>
  createModal({
    content: <RunEditContent {...props} />,
    footer: null,
    styles: {
      content: { padding: 0 },
    },
    title: t('run.edit.title', { ns: 'eval' }),
    width: 520,
  });
