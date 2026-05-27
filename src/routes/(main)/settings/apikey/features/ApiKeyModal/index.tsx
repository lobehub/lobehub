'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
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
    width: 'min(90vw, 560px)',
  });
