'use client';

import { createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import type { VerifyCriterionDraft } from '@/services/verify';

import { CriterionEditor, type CriterionEditorProps } from './CriterionEditor';

/**
 * A component rather than a `t()` string so a lazily loaded `verify` namespace
 * still updates the title after the modal is already open.
 */
const ModalTitle = ({ isNew }: { isNew?: boolean }) => {
  const { t } = useTranslation('verify');

  return isNew ? t('criterion.addTitle') : t('criterion.editTitle');
};

const ModalContent = (props: Omit<CriterionEditorProps, 'onClose'>) => {
  const { close } = useModalContext();

  return <CriterionEditor {...props} onClose={close} />;
};

export interface OpenCriterionEditModalProps {
  criterion: VerifyCriterionDraft;
  /** Create flow: the criterion only exists once it is saved. */
  isNew?: boolean;
  onDelete?: () => void;
  onSubmit: (next: VerifyCriterionDraft) => void;
}

/** Imperatively open the shared criterion editor in a modal. */
export const openCriterionEditModal = ({
  criterion,
  isNew,
  onDelete,
  onSubmit,
}: OpenCriterionEditModalProps): ModalInstance =>
  createModal({
    content: (
      <ModalContent initial={criterion} isNew={isNew} onDelete={onDelete} onSubmit={onSubmit} />
    ),
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: <ModalTitle isNew={isNew} />,
    width: 'min(90vw, 560px)',
  });
