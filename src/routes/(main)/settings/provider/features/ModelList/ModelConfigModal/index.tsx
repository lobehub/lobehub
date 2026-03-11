import { Button, Modal } from '@lobehub/ui';
import { type FormInstance } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, use, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import ModelConfigForm from '../CreateNewModelModal/Form';
import { ProviderSettingsContext } from '../ProviderSettingsContext';

interface ModelConfigModalProps {
  id: string;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const ModelConfigModal = memo<ModelConfigModalProps>(({ id, open, setOpen }) => {
  const { t } = useTranslation(['common', 'setting']);
  const [formInstance, setFormInstance] = useState<FormInstance>();
  const [loading, setLoading] = useState(false);
  const [editingProvider, updateAiModelsConfig] = useAiInfraStore((s) => [
    s.activeAiProvider!,
    s.updateAiModelsConfig,
  ]);
  const model = useAiInfraStore(aiModelSelectors.getAiModelById(id), isEqual);

  const closeModal = () => {
    setOpen(false);
  };
  const { showDeployName } = use(ProviderSettingsContext);

  return (
    <Modal
      destroyOnHidden
      maskClosable
      open={open}
      title={t('llm.customModelCards.modelConfig.modalTitle', { ns: 'setting' })}
      zIndex={1251} // Select is 1150
      footer={[
        <Button key="cancel" onClick={closeModal}>
          {t('cancel')}
        </Button>,
        <Button
          key="ok"
          loading={loading}
          style={{ marginInlineStart: '16px' }}
          type="primary"
          onClick={async () => {
            if (!editingProvider || !id || !formInstance) return;
            const data = formInstance.getFieldsValue();

            setLoading(true);
            await updateAiModelsConfig(id, editingProvider, data);
            setLoading(false);

            closeModal();
          }}
        >
          {t('ok')}
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
      <ModelConfigForm
        idEditable={false}
        initialValues={model}
        showDeployName={showDeployName}
        type={model?.type}
        onFormInstanceReady={setFormInstance}
      />
    </Modal>
  );
});
export default ModelConfigModal;
