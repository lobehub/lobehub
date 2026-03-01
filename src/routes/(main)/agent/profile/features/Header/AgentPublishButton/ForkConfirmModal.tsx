'use client';

import { Avatar, Flexbox, Modal } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface OriginalAgentInfo {
  author?: {
    avatar?: string;
    name?: string;
    userName?: string;
  };
  avatar?: string;
  identifier: string;
  name: string;
}

interface ForkConfirmModalProps {
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  originalAgent: OriginalAgentInfo | null;
}

const ForkConfirmModal = memo<ForkConfirmModalProps>(
  ({ open, onCancel, onConfirm, originalAgent, loading }) => {
    const { t } = useTranslation('setting');

    if (!originalAgent) return null;

    const authorName = originalAgent.author?.name || originalAgent.author?.userName || 'Unknown';

    return (
      <Modal
        centered
        closable
        cancelText={t('cancel', { ns: 'common' })}
        confirmLoading={loading}
        okText={t('marketPublish.forkConfirm.confirm')}
        open={open}
        title={t('marketPublish.forkConfirm.title')}
        width={480}
        onCancel={onCancel}
        onOk={onConfirm}
      >
        <Flexbox gap={16} style={{ marginTop: 16 }}>
          <Flexbox horizontal align="center" gap={12}>
            <Avatar avatar={originalAgent.avatar} size={48} style={{ flex: 'none' }} />
            <Flexbox gap={4}>
              <div style={{ fontWeight: 500 }}>{originalAgent.name}</div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>
                {t('marketPublish.forkConfirm.by', { author: authorName })}
              </div>
            </Flexbox>
          </Flexbox>

          <p style={{ lineHeight: 1.6, margin: 0 }}>{t('marketPublish.forkConfirm.description')}</p>
        </Flexbox>
      </Modal>
    );
  },
);

ForkConfirmModal.displayName = 'ForkConfirmModal';

export default ForkConfirmModal;
