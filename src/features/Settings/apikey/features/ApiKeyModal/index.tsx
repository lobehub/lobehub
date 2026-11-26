'use client';

import { createModal, type ModalInstance } from '@lobehub/ui';
import { t } from 'i18next';

import ApiKeyModalContent, { type ApiKeyModalContentProps } from './Content';

export const createApiKeyModal = (props: ApiKeyModalContentProps): ModalInstance =>
  createModal({
    content: <ApiKeyModalContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { paddingBlock: 16, paddingInline: 24 },
    },
    title: t('apikey.form.title', { ns: 'auth' }),
    // Wide enough to show a 64-character key on one line.
    width: 'min(90vw, 600px)',
  });
