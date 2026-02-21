'use client';

import { Button, Flexbox, Modal } from '@lobehub/ui';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { type SettingsRef } from './index';
import Settings from './index';

interface McpSettingsModalProps {
  identifier: string;
  onClose: () => void;
  open: boolean;
}

const McpSettingsModal = memo<McpSettingsModalProps>(({ identifier, open, onClose }) => {
  const { t } = useTranslation(['plugin', 'common']);
  const settingsRef = useRef<SettingsRef>(null);

  const footer = (
    <Flexbox horizontal justify="space-between" style={{ width: '100%' }}>
      <Button
        onClick={() => {
          settingsRef.current?.reset();
        }}
      >
        {t('common:reset')}
      </Button>
      <Flexbox horizontal gap={8}>
        <Button onClick={onClose}>{t('common:cancel')}</Button>
        <Button
          type="primary"
          onClick={() => {
            settingsRef.current?.save();
          }}
        >
          {t('common:save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );

  return (
    <Modal
      destroyOnHidden
      footer={footer}
      open={open}
      title={t('plugin:dev.title.skillSettings')}
      width={600}
      onCancel={onClose}
    >
      <Settings hideFooter identifier={identifier} ref={settingsRef} />
    </Modal>
  );
});

McpSettingsModal.displayName = 'McpSettingsModal';

export default McpSettingsModal;
