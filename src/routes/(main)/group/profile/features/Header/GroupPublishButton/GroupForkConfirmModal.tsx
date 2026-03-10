'use client';

import { Avatar, Flexbox, Modal } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type OriginalGroupInfo } from './types';

interface GroupForkConfirmModalProps {
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  originalGroup: OriginalGroupInfo | null;
}

const GroupForkConfirmModal = memo<GroupForkConfirmModalProps>(
  ({ open, onCancel, onConfirm, originalGroup, loading }) => {
    const { t } = useTranslation('setting');

    if (!originalGroup) return null;

    const authorName = originalGroup.author?.name || originalGroup.author?.userName || 'Unknown';

    return (
      <Modal
        centered
        closable
        cancelText={t('cancel', { ns: 'common' })}
        confirmLoading={loading}
        okText={t('marketPublish.forkConfirm.confirmGroup')}
        open={open}
        title={t('marketPublish.forkConfirm.titleGroup')}
        width={480}
        onCancel={onCancel}
        onOk={onConfirm}
      >
        <Flexbox gap={16} style={{ marginTop: 16 }}>
          <Flexbox horizontal align="center" gap={12}>
            <Avatar avatar={originalGroup.avatar} size={48} style={{ flex: 'none' }} />
            <Flexbox gap={4}>
              <div style={{ fontWeight: 500 }}>{originalGroup.name}</div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>
                {t('marketPublish.forkConfirm.by', { author: authorName })}
              </div>
            </Flexbox>
          </Flexbox>

          <p style={{ lineHeight: 1.6, margin: 0 }}>
            {t('marketPublish.forkConfirm.descriptionGroup')}
          </p>
        </Flexbox>
      </Modal>
    );
  },
);

GroupForkConfirmModal.displayName = 'GroupForkConfirmModal';

export default GroupForkConfirmModal;
