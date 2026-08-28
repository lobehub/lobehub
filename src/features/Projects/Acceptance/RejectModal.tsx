'use client';

import { TextArea } from '@lobehub/ui';
import { Button, createModal, ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const RejectContent = memo<{ onReject: (comment: string) => Promise<void> }>(({ onReject }) => {
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <>
      <div style={{ padding: 16 }}>
        <TextArea
          autoFocus
          placeholder={t('acceptance.rejectPlaceholder')}
          rows={4}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </div>
      <ModalFooter>
        <Button onClick={close}>{t('acceptance.cancel')}</Button>
        <Button
          disabled={!comment.trim()}
          loading={loading}
          type={'primary'}
          onClick={async () => {
            setLoading(true);
            try {
              await onReject(comment.trim());
              close();
            } finally {
              setLoading(false);
            }
          }}
        >
          {t('acceptance.reject')}
        </Button>
      </ModalFooter>
    </>
  );
});

export const openRejectProjectModal = (onReject: (comment: string) => Promise<void>) =>
  createModal({
    content: <RejectContent onReject={onReject} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('acceptance.rejectTitle', { ns: 'project' }),
    width: 440,
  });
