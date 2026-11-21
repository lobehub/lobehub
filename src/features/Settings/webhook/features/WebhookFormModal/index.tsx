'use client';

import { createModal, type ModalInstance } from '@lobehub/ui';
import { t } from 'i18next';

import { WebhookFormContent, type WebhookFormContentProps } from './Content';

export const createWebhookFormModal = (props: WebhookFormContentProps): ModalInstance =>
  createModal({
    content: <WebhookFormContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: { content: { paddingBlock: 16, paddingInline: 24 } },
    title: t(props.initialValues ? 'webhook.form.editTitle' : 'webhook.form.createTitle', {
      ns: 'setting',
    }),
    width: 'min(90vw, 600px)',
  });
