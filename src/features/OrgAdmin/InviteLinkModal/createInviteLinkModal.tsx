'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { InviteLinkModalContent, type InviteLinkModalContentProps } from './Content';

export const createInviteLinkModal = (props: InviteLinkModalContentProps): ModalInstance =>
  createModal({
    content: <InviteLinkModalContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { paddingBlock: 8, paddingInline: 24 },
    },
    title: t('org.invite.linkTitle', { ns: 'aico' }),
    width: 'min(90vw, 520px)',
  });
