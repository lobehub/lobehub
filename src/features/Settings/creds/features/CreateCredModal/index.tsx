'use client';

import { createModal, type ModalInstance } from '@lobehub/ui';
import { t } from 'i18next';

import CredModalTitle from '../CredModalTitle';
import CreateCredModalContent, { type CreateCredModalContentProps } from './Content';

export const createCreateCredModal = (props: CreateCredModalContentProps): ModalInstance =>
  createModal({
    content: <CreateCredModalContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { paddingBlock: 16, paddingInline: 24 },
    },
    title: (
      <CredModalTitle
        title={t(`creds.createModal.titles.${props.type}`, { ns: 'setting' })}
        type={props.type}
      />
    ),
    width: 'min(90vw, 560px)',
  });
