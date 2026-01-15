'use client';

import { Modal } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Settings from './Settings';

interface McpSettingsModalProps {
  identifier: string;
  onClose: () => void;
  open: boolean;
}

const McpSettingsModal = memo<McpSettingsModalProps>(({ identifier, open, onClose }) => {
  const { t } = useTranslation('plugin');

  return (
    <Modal
      destroyOnHidden
      footer={null}
      onCancel={onClose}
      open={open}
      title={t('dev.title.skillSettings')}
      width={600}
    >
      <Settings identifier={identifier} />
    </Modal>
  );
});

McpSettingsModal.displayName = 'McpSettingsModal';

export default McpSettingsModal;
