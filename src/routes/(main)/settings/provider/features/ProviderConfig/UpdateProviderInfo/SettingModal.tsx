import { ProviderIcon } from '@lobehub/icons';
import { type FormItemProps } from '@lobehub/ui';
import { Button, Flexbox, FormModal, Icon, Input, Select, TextArea } from '@lobehub/ui';
import { App } from 'antd';
import { BrainIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useAiInfraStore } from '@/store/aiInfra/store';
import { type AiProviderDetailItem, type UpdateAiProviderParams } from '@/types/aiProvider';

import { CUSTOM_PROVIDER_SDK_OPTIONS } from '../../customProviderSdkOptions';

interface CreateNewProviderProps {
  id: string;
  initialValues: AiProviderDetailItem;
  onClose?: () => void;
  open?: boolean;
}

const CreateNewProvider = memo<CreateNewProviderProps>(({ onClose, open, initialValues, id }) => {
  const { t } = useTranslation(['modelProvider', 'common']);
  const [loading, setLoading] = useState(false);
  const [updateAiProvider, deleteAiProvider] = useAiInfraStore((s) => [
    s.updateAiProvider,
    s.deleteAiProvider,
  ]);

  const { message, modal } = App.useApp();
  const navigate = useNavigate();

  const onFinish = async (values: UpdateAiProviderParams) => {
    setLoading(true);

    try {
      await updateAiProvider(id, values);
      setLoading(false);
      message.success(t('updateAiProvider.updateSuccess'));
      onClose?.();
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const basicItems: FormItemProps[] = [
    {
      children: initialValues.id,
      label: t('createNewAiProvider.id.title'),
      minWidth: 400,
      rules: [{ message: t('createNewAiProvider.id.required'), required: true }],
    },
    {
      children: (
        <Input placeholder={t('createNewAiProvider.name.placeholder')} variant={'filled'} />
      ),
      label: t('createNewAiProvider.name.title'),
      minWidth: 400,
      name: 'name',
      rules: [{ message: t('createNewAiProvider.name.required'), required: true }],
    },
    {
      children: (
        <TextArea
          placeholder={t('createNewAiProvider.description.placeholder')}
          style={{ minHeight: 80 }}
          variant={'filled'}
        />
      ),
      label: t('createNewAiProvider.description.title'),
      minWidth: 400,
      name: 'description',
    },
    {
      children: <Input allowClear placeholder={'https://logo-url'} variant={'filled'} />,
      label: t('createNewAiProvider.logo.title'),
      minWidth: 400,
      name: 'logo',
    },
  ];

  const configItems: FormItemProps[] = [
    {
      children: (
        <Select
          options={CUSTOM_PROVIDER_SDK_OPTIONS}
          placeholder={t('createNewAiProvider.sdkType.placeholder')}
          variant={'filled'}
          optionRender={({ label, value }) => {
            // Map 'router' to 'newapi' for displaying the correct icon
            const iconProvider = value === 'router' ? 'newapi' : (value as string);
            return (
              <Flexbox horizontal align={'center'} gap={8}>
                <ProviderIcon provider={iconProvider} size={18} />
                {label}
              </Flexbox>
            );
          }}
        />
      ),
      label: t('createNewAiProvider.sdkType.title'),
      minWidth: 400,
      name: ['settings', 'sdkType'],
      rules: [{ message: t('createNewAiProvider.sdkType.required'), required: true }],
    },
  ];

  return (
    <FormModal
      initialValues={initialValues}
      open={open}
      scrollToFirstError={{ behavior: 'instant', block: 'end', focus: true }}
      submitText={t('createNewAiProvider.confirm')}
      footer={
        <Flexbox horizontal justify={'space-between'}>
          <Button
            danger
            disabled={loading}
            type={'primary'}
            onClick={() => {
              modal.confirm({
                okButtonProps: {
                  danger: true,
                },
                okText: t('delete', { ns: 'common' }),
                onOk: async () => {
                  await deleteAiProvider(id);
                  navigate('/settings/provider/all');

                  onClose?.();
                  message.success(t('updateAiProvider.deleteSuccess'));
                },
                title: t('updateAiProvider.confirmDelete'),
              });
            }}
          >
            {t('delete', { ns: 'common' })}
          </Button>
          <Flexbox horizontal gap={8}>
            <Button htmlType={'submit'} loading={loading} type={'primary'}>
              {t('update', { ns: 'common' })}
            </Button>
          </Flexbox>
        </Flexbox>
      }
      items={[
        {
          children: basicItems,
          title: t('createNewAiProvider.basicTitle'),
        },
        {
          children: configItems,
          title: t('createNewAiProvider.configTitle'),
        },
      ]}
      title={
        <Flexbox horizontal gap={8}>
          <Icon icon={BrainIcon} />
          {t('updateCustomAiProvider.title')}
        </Flexbox>
      }
      onCancel={onClose}
      onFinish={onFinish}
    />
  );
});

export default CreateNewProvider;
