'use client';

import {
  Button,
  Flexbox,
  Input,
  InputPassword,
  Select,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { AiProviderBaseURLSchema } from 'model-bank/aiProvider';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ProviderIcon } from '@/components/LobeIcons';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAiInfraStore } from '@/store/aiInfra/store';
import { type CreateAiProviderParams } from '@/types/aiProvider';

import { KeyVaultsConfigKey, LLMProviderApiTokenKey, LLMProviderBaseUrlKey } from '../../const';
import { CUSTOM_PROVIDER_SDK_OPTIONS } from '../customProviderSdkOptions';
import { normalizeProviderSettings } from '../providerSettings';

const SectionTitle = memo<{ children: React.ReactNode }>(({ children }) => (
  <Text fontSize={13} type={'secondary'} weight={500}>
    {children}
  </Text>
));

const CreateNewProviderContent = memo(() => {
  const { t } = useTranslation('modelProvider');
  const [loading, setLoading] = useState(false);
  const createNewAiProvider = useAiInfraStore((s) => s.createNewAiProvider);

  const navigate = useWorkspaceAwareNavigate();
  const { close } = useModalContext();

  const onFinish = async (values: CreateAiProviderParams) => {
    setLoading(true);

    try {
      const finalValues = {
        ...values,
        name: values.name || values.id,
        settings: normalizeProviderSettings({
          nextSettings: values.settings,
        }) as CreateAiProviderParams['settings'],
      };

      await createNewAiProvider(finalValues);
      setLoading(false);
      navigate(`/settings/provider/${values.id}`);
      toast.success(t('createNewAiProvider.createSuccess'));
      close();
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const form = useForm<CreateAiProviderParams>({ onSubmit: onFinish });

  const itemStyle = { paddingBlock: 0 };

  return (
    <Form form={form} layout={'vertical'}>
      <Flexbox gap={16}>
        <SectionTitle>{t('createNewAiProvider.basicTitle')}</SectionTitle>

        <Form.Field
          extra={t('createNewAiProvider.id.desc')}
          label={t('createNewAiProvider.id.title')}
          name={'id'}
          required={t('createNewAiProvider.id.required')}
          style={itemStyle}
          validate={(value?: string) => {
            if (!value) return;
            if (!/^[\d_a-z-]+$/.test(value)) return t('createNewAiProvider.id.format');
            const list = useAiInfraStore.getState().aiProviderList;
            if (list.some((p) => p.id === value)) return t('createNewAiProvider.id.duplicate');
          }}
        >
          <Input
            autoFocus
            placeholder={t('createNewAiProvider.id.placeholder')}
            variant={'filled'}
          />
        </Form.Field>

        <Form.Field label={t('createNewAiProvider.name.title')} name={'name'} style={itemStyle}>
          <Input placeholder={t('createNewAiProvider.name.placeholder')} variant={'filled'} />
        </Form.Field>

        <Form.Field
          label={t('createNewAiProvider.description.title')}
          name={'description'}
          style={itemStyle}
        >
          <TextArea
            placeholder={t('createNewAiProvider.description.placeholder')}
            style={{ minHeight: 72 }}
            variant={'filled'}
          />
        </Form.Field>

        <Form.Field label={t('createNewAiProvider.logo.title')} name={'logo'} style={itemStyle}>
          <Input
            allowClear
            placeholder={t('createNewAiProvider.logo.placeholder')}
            variant={'filled'}
          />
        </Form.Field>

        <div style={{ marginBlockStart: 8 }}>
          <SectionTitle>{t('createNewAiProvider.configTitle')}</SectionTitle>
        </div>

        <Form.Field
          label={t('createNewAiProvider.sdkType.title')}
          name={'settings.sdkType'}
          required={t('createNewAiProvider.sdkType.required')}
          style={itemStyle}
        >
          <Select
            options={CUSTOM_PROVIDER_SDK_OPTIONS}
            placeholder={t('createNewAiProvider.sdkType.placeholder')}
            variant={'filled'}
            optionRender={({ label, value }) => {
              const iconProvider = value === 'router' ? 'newapi' : (value as string);
              return (
                <Flexbox horizontal align={'center'} gap={8}>
                  <ProviderIcon provider={iconProvider} size={18} />
                  {label}
                </Flexbox>
              );
            }}
          />
        </Form.Field>

        <Form.Field
          label={t('createNewAiProvider.proxyUrl.title')}
          name={`${KeyVaultsConfigKey}.${LLMProviderBaseUrlKey}`}
          required={t('createNewAiProvider.proxyUrl.required')}
          style={itemStyle}
          validate={(value?: string) =>
            !value || AiProviderBaseURLSchema.safeParse(value).success
              ? undefined
              : t('providerModels.config.baseURL.invalid')
          }
        >
          <Input
            allowClear
            placeholder={t('createNewAiProvider.proxyUrl.placeholder')}
            variant={'filled'}
          />
        </Form.Field>

        <Form.Field
          label={t('createNewAiProvider.apiKey.title')}
          name={`${KeyVaultsConfigKey}.${LLMProviderApiTokenKey}`}
          style={itemStyle}
        >
          <InputPassword
            autoComplete={'new-password'}
            placeholder={t('createNewAiProvider.apiKey.placeholder')}
            variant={'filled'}
          />
        </Form.Field>

        <Button block htmlType={'submit'} loading={loading} type={'primary'}>
          {t('createNewAiProvider.confirm')}
        </Button>
      </Flexbox>
    </Form>
  );
});

export default CreateNewProviderContent;
