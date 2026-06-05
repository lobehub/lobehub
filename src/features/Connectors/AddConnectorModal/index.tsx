import { Modal } from '@lobehub/ui/base-ui';
import { Input } from 'antd';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
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
  const [clientId, setClientId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleAdd = async () => {
    if (!name.trim() || !url.trim()) return;
    await createConnector({
      identifier: name.toLowerCase().replaceAll(/\s+/g, '-'),
      mcpConnectionType: 'http',
      mcpServerUrl: url.trim(),
      name: name.trim(),
      oidcConfig: clientId.trim()
        ? { clientId: clientId.trim(), scheme: 'pre_registration' }
        : undefined,
      sourceType: ConnectorSourceType.custom,
    });
    setName('');
    setUrl('');
    setClientId('');
    setShowAdvanced(false);
    onClose();
  };

  const handleCancel = () => {
    setName('');
    setUrl('');
    setClientId('');
    setShowAdvanced(false);
    onClose();
  };

  return (
    <Modal
      cancelText={t('connector.add.cancel', 'Cancel')}
      confirmLoading={creating}
      okButtonProps={{ disabled: !name.trim() || !url.trim() }}
      okText={t('connector.add.confirm', 'Add')}
      open={open}
      title={t('connector.add.title', 'Add custom connector')}
      onCancel={handleCancel}
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

        {/* Advanced settings */}
        <div>
          <div
            style={{
              alignItems: 'center',
              cursor: 'pointer',
              display: 'flex',
              fontSize: 13,
              fontWeight: 500,
              gap: 4,
              userSelect: 'none',
            }}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
            {t('connector.add.advanced', 'Advanced settings')}
          </div>

          {showAdvanced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <Input
                placeholder={t('connector.add.clientId', 'OAuth Client ID (optional)')}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
              <Input.Password
                placeholder={t('connector.add.clientSecret', 'OAuth Client Secret (optional)')}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
});

AddConnectorModal.displayName = 'AddConnectorModal';

export default AddConnectorModal;
