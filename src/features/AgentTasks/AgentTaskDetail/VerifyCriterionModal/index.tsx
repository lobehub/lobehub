'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import type { VerifyCriterionDraft } from '@/services/verify';

import VerifyCriterionForm from './VerifyCriterionForm';

interface OpenVerifyCriterionModalProps {
  initial: VerifyCriterionDraft;
  onDelete?: () => void;
  onSubmit: (next: VerifyCriterionDraft) => void;
}

/** Imperatively open the per-criterion detail editor. */
export const openVerifyCriterionModal = ({
  initial,
  onDelete,
  onSubmit,
}: OpenVerifyCriterionModalProps) =>
  createModal({
    content: <VerifyCriterionForm initial={initial} onDelete={onDelete} onSubmit={onSubmit} />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: t('verifyConfig.detail.title', { ns: 'chat' }),
    width: 'min(90%, 480px)',
  });
