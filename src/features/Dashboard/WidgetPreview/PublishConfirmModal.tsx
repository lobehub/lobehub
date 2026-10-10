'use client';

import { Button, createModal, Flexbox, ModalFooter, useModalContext  } from '@lobehub/ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PublishReview from './PublishReview';

interface PublishConfirmModalProps {
  /** Runs when the user confirms; a failure keeps the modal open. */
  onConfirm: () => Promise<void>;
  versionId: string;
  widgetId: string;
}

/**
 * The gate behind the preview's Publish action: the same review the
 * agent-side requestPublish intervention renders — the dry run, what the
 * version may touch, the cadence publishing will actually retain and the
 * exact code diff — with an explicit confirm. The confirm stays disabled
 * until the reviewed version is on screen, exactly like the intervention's
 * approve action.
 */
const PublishConfirmModal = memo<PublishConfirmModalProps>(({ widgetId, versionId, onConfirm }) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const { close } = useModalContext();
  const [blocked, setBlocked] = useState(true);
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      await onConfirm();
      close();
    } catch {
      // The confirm handler already surfaced the failure (toast) — keep the
      // review open so the user can fix and retry.
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <Flexbox gap={12} padding={16}>
        <PublishReview
          versionId={versionId}
          widgetId={widgetId}
          onApprovalBlockedChange={setBlocked}
        />
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={blocked}
          loading={confirming}
          type={'primary'}
          onClick={() => void handleConfirm()}
        >
          {t('chat.publish')}
        </Button>
      </ModalFooter>
    </>
  );
});

PublishConfirmModal.displayName = 'DashboardPublishConfirmModal';

/** Open the publish review gate for one version of a widget. */
export const openPublishConfirmModal = ({
  onConfirm,
  versionId,
  widgetId,
}: {
  onConfirm: () => Promise<void>;
  versionId: string;
  widgetId: string;
}) =>
  createModal({
    content: (
      <PublishConfirmModal versionId={versionId} widgetId={widgetId} onConfirm={onConfirm} />
    ),
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('chat.publishReviewTitle', { ns: 'dashboard' }),
    width: 560,
  });
