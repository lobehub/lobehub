'use client';

import { Button, Flexbox, Modal } from '@lobehub/ui';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import Settings, { type SettingsRef } from './index';

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
      <Flexbox gap={8} horizontal>
        <Button onClick={onClose}>{t('common:cancel')}</Button>
        <Button
          onClick={() => {
            settingsRef.current?.save();
          }}
          type="primary"
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
      onCancel={onClose}
      open={open}
      title={t('plugin:dev.title.skillSettings')}
      width={600}
    >
      <Settings hideFooter identifier={identifier} ref={settingsRef} />
    </Modal>
  );
});

McpSettingsModal.displayName = 'McpSettingsModal';

export default McpSettingsModal;
