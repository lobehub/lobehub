import { ProviderIcon } from '@lobehub/icons';
import { type FormItemProps } from '@lobehub/ui';
import { Flexbox, FormModal, Icon, Input, InputPassword, Select, TextArea } from '@lobehub/ui';
import { App } from 'antd';
import { BrainIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useAiInfraStore } from '@/store/aiInfra/store';
import { type CreateAiProviderParams } from '@/types/aiProvider';

import { KeyVaultsConfigKey, LLMProviderApiTokenKey, LLMProviderBaseUrlKey } from '../../const';
import { CUSTOM_PROVIDER_SDK_OPTIONS } from '../customProviderSdkOptions';

interface CreateNewProviderProps {
  onClose?: () => void;
  open?: boolean;
}

const CreateNewProvider = memo<CreateNewProviderProps>(({ onClose, open }) => {
  const { t } = useTranslation('modelProvider');
  const [loading, setLoading] = useState(false);
  const createNewAiProvider = useAiInfraStore((s) => s.createNewAiProvider);
  const { message } = App.useApp();
  const navigate = useNavigate();
  const onFinish = async (values: CreateAiProviderParams) => {
    setLoading(true);

    try {
      // 如果 name 为空，使用 id 作为 name
      const finalValues = {
        ...values,
        name: values.name || values.id,
      };

      // 只为 openai 和 router (newapi) 类型的自定义 provider 添加 supportResponsesApi: true
      const sdkType = values.settings?.sdkType;
      if (sdkType === 'openai' || sdkType === 'router') {
        finalValues.settings = {
          ...finalValues.settings,
          supportResponsesApi: true,
        };
      }

      await createNewAiProvider(finalValues);
      setLoading(false);
      navigate(`/settings/provider/${values.id}`);
      message.success(t('createNewAiProvider.createSuccess'));
      onClose?.();
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const basicItems: FormItemProps[] = [
    {
      children: (
        <Input autoFocus placeholder={t('createNewAiProvider.id.placeholder')} variant={'filled'} />
      ),
      desc: t('createNewAiProvider.id.desc'),
      label: t('createNewAiProvider.id.title'),
      minWidth: 400,
      name: 'id',
      rules: [
        { message: t('createNewAiProvider.id.required'), required: true },
        {
          message: t('createNewAiProvider.id.format'),
          pattern: /^[\d_a-z-]+$/,
        },
      ],
    },
    {
      children: (
        <Input placeholder={t('createNewAiProvider.name.placeholder')} variant={'filled'} />
      ),
      label: t('createNewAiProvider.name.title'),
      minWidth: 400,
      name: 'name',
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
      children: (
        <Input
          allowClear
          placeholder={t('createNewAiProvider.logo.placeholder')}
          variant={'filled'}
        />
      ),
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
    {
      children: <Input allowClear placeholder={t('createNewAiProvider.proxyUrl.placeholder')} />,
      label: t('createNewAiProvider.proxyUrl.title'),
      minWidth: 400,
      name: [KeyVaultsConfigKey, LLMProviderBaseUrlKey],
      rules: [{ message: t('createNewAiProvider.proxyUrl.required'), required: true }],
    },
    {
      children: (
        <InputPassword
          autoComplete={'new-password'}
          placeholder={t('createNewAiProvider.apiKey.placeholder')}
          variant={'filled'}
        />
      ),
      label: t('createNewAiProvider.apiKey.title'),
      minWidth: 400,
      name: [KeyVaultsConfigKey, LLMProviderApiTokenKey],
    },
  ];

  return (
    <FormModal
      destroyOnHidden
      open={open}
      scrollToFirstError={{ behavior: 'instant', block: 'end', focus: true }}
      submitLoading={loading}
      submitText={t('createNewAiProvider.confirm')}
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
          {t('createNewAiProvider.title')}
        </Flexbox>
      }
      onCancel={onClose}
      onFinish={onFinish}
    />
  );
});

export default CreateNewProvider;
