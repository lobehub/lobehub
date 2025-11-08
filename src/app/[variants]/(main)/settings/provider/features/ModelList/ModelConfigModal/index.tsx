import { Button, Modal } from '@lobehub/ui';
import { FormInstance } from 'antd';
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
      footer={[
        <Button key="cancel" onClick={closeModal}>
          {t('cancel')}
        </Button>,
        <Button
          key="ok"
          loading={loading}
          onClick={async () => {
            if (!editingProvider || !id || !formInstance) return;
            const data = formInstance.getFieldsValue();

            setLoading(true);
            await updateAiModelsConfig(id, editingProvider, data);
            setLoading(false);

            closeModal();
          }}
          style={{ marginInlineStart: '16px' }}
          type="primary"
        >
          {t('ok')}
        </Button>,
      ]}
      maskClosable
      onCancel={closeModal}
      open={open}
      styles={{
        content: {
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100vh - 150px)',
        },
      }}
      title={t('llm.customModelCards.modelConfig.modalTitle', { ns: 'setting' })}
      zIndex={1251} // Select is 1150
    >
      <ModelConfigForm
        idEditable={false}
        initialValues={model}
        onFormInstanceReady={setFormInstance}
        showDeployName={showDeployName}
        type={model?.type}
      />
    </Modal>
  );
});
export default ModelConfigModal;
