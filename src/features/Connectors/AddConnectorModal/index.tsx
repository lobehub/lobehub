import { Modal } from '@lobehub/ui/base-ui';
import { Input } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectorSourceType } from '@/database/schemas';
import { useToolStore } from '@/store/tool';

interface AddConnectorModalProps {
  onClose: () => void;
  open: boolean;
}

const AddConnectorModal = memo<AddConnectorModalProps>(({ open, onClose }) => {
  const { t } = useTranslation('tool');
  const createConnector = useToolStore((s) => s.createConnector);
  const creating = useToolStore((s) => s.connectorCreating);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const handleAdd = async () => {
    if (!name.trim() || !url.trim()) return;
    await createConnector({
      identifier: name.toLowerCase().replaceAll(/\s+/g, '-'),
      mcpConnectionType: 'http',
      mcpServerUrl: url.trim(),
      name: name.trim(),
      sourceType: ConnectorSourceType.custom,
    });
    setName('');
    setUrl('');
    onClose();
  };

  return (
    <Modal
      cancelText={t('connector.add.cancel', 'Cancel')}
      okButtonProps={{ disabled: !name.trim() || !url.trim(), loading: creating }}
      okText={t('connector.add.confirm', 'Add')}
      open={open}
      title={t('connector.add.title', 'Add custom connector')}
      onCancel={onClose}
      onOk={handleAdd}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>{t('connector.add.name', 'Name')}</div>
          <Input
            placeholder={t('connector.add.namePlaceholder', 'My connector')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            {t('connector.add.url', 'Remote MCP server URL')}
          </div>
          <Input
            placeholder="https://mcp.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
});

AddConnectorModal.displayName = 'AddConnectorModal';

export default AddConnectorModal;
