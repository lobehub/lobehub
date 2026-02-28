import { Button, Modal } from '@lobehub/ui';
import { type FormInstance } from 'antd';
import { memo, use, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAiInfraStore } from '@/store/aiInfra';

import { ProviderSettingsContext } from '../ProviderSettingsContext';
import ModelConfigForm from './Form';

interface ModelConfigModalProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const ModelConfigModal = memo<ModelConfigModalProps>(({ open, setOpen }) => {
  const { t } = useTranslation(['modelProvider', 'common']);
  const [formInstance, setFormInstance] = useState<FormInstance>();
  const [loading, setLoading] = useState(false);
  const [editingProvider, createNewAiModel] = useAiInfraStore((s) => [
    s.activeAiProvider!,
    s.createNewAiModel,
  ]);

  const closeModal = () => {
    setOpen(false);
  };

  const { showDeployName } = use(ProviderSettingsContext);

  return (
    <Modal
      destroyOnHidden
      maskClosable
      open={open}
      title={t('providerModels.createNew.title')}
      zIndex={1251} // Select is 1150
      footer={[
        <Button key="cancel" onClick={closeModal}>
          {t('cancel', { ns: 'common' })}
        </Button>,

        <Button
          key="ok"
          loading={loading}
          style={{ marginInlineStart: '16px' }}
          type="primary"
          onClick={async () => {
            if (!editingProvider || !formInstance) return;
            const data = formInstance.getFieldsValue();

            setLoading(true);

            try {
              await formInstance.validateFields();
              await createNewAiModel({ ...data, providerId: editingProvider });
              setLoading(false);
              closeModal();
            } catch {
              setLoading(false);
            }
          }}
        >
          {t('ok', { ns: 'common' })}
        </Button>,
      ]}
      styles={{
        body: {
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100vh - 150px)',
        },
      }}
      onCancel={closeModal}
    >
      <ModelConfigForm showDeployName={showDeployName} onFormInstanceReady={setFormInstance} />
    </Modal>
  );
});
export default ModelConfigModal;
