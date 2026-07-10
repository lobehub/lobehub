'use client';

import { ProviderIcon } from '@lobehub/icons';
import { Button, Flexbox, Input, InputPassword, Text, TextArea } from '@lobehub/ui';
import { Select, useModalContext } from '@lobehub/ui/base-ui';
import { App, Form } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const [form] = Form.useForm<CreateAiProviderParams>();
  const [loading, setLoading] = useState(false);
  const createNewAiProvider = useAiInfraStore((s) => s.createNewAiProvider);
  const { message } = App.useApp();
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
      message.success(t('createNewAiProvider.createSuccess'));
      close();
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const itemStyle = { marginBottom: 0 };

  return (
    <Form
      colon={false}
      form={form}
      layout={'vertical'}
      scrollToFirstError={{ behavior: 'instant', block: 'end', focus: true }}
      onFinish={onFinish}
    >
      <Flexbox gap={16}>
        <SectionTitle>{t('createNewAiProvider.basicTitle')}</SectionTitle>

        <Form.Item
          extra={t('createNewAiProvider.id.desc')}
          label={t('createNewAiProvider.id.title')}
          name={'id'}
          style={itemStyle}
          rules={[
            { message: t('createNewAiProvider.id.required'), required: true },
            {
              message: t('createNewAiProvider.id.format'),
              pattern: /^[\d_a-z-]+$/,
            },
            {
              message: t('createNewAiProvider.id.duplicate'),
              validator: (_, value: string) => {
                const list = useAiInfraStore.getState().aiProviderList;
                if (value && list.some((p) => p.id === value)) {
                  return Promise.reject();
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <Input
            autoFocus
            placeholder={t('createNewAiProvider.id.placeholder')}
            variant={'filled'}
          />
        </Form.Item>

        <Form.Item label={t('createNewAiProvider.name.title')} name={'name'} style={itemStyle}>
          <Input placeholder={t('createNewAiProvider.name.placeholder')} variant={'filled'} />
        </Form.Item>

        <Form.Item
          label={t('createNewAiProvider.description.title')}
          name={'description'}
          style={itemStyle}
        >
          <TextArea
            placeholder={t('createNewAiProvider.description.placeholder')}
            style={{ minHeight: 72 }}
            variant={'filled'}
          />
        </Form.Item>

        <Form.Item label={t('createNewAiProvider.logo.title')} name={'logo'} style={itemStyle}>
          <Input
            allowClear
            placeholder={t('createNewAiProvider.logo.placeholder')}
            variant={'filled'}
          />
        </Form.Item>

        <div style={{ marginBlockStart: 8 }}>
          <SectionTitle>{t('createNewAiProvider.configTitle')}</SectionTitle>
        </div>

        <Form.Item
          label={t('createNewAiProvider.sdkType.title')}
          name={['settings', 'sdkType']}
          rules={[{ message: t('createNewAiProvider.sdkType.required'), required: true }]}
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
        </Form.Item>

        <Form.Item
          label={t('createNewAiProvider.proxyUrl.title')}
          name={[KeyVaultsConfigKey, LLMProviderBaseUrlKey]}
          rules={[{ message: t('createNewAiProvider.proxyUrl.required'), required: true }]}
          style={itemStyle}
        >
          <Input
            allowClear
            placeholder={t('createNewAiProvider.proxyUrl.placeholder')}
            variant={'filled'}
          />
        </Form.Item>

        <Form.Item
          label={t('createNewAiProvider.apiKey.title')}
          name={[KeyVaultsConfigKey, LLMProviderApiTokenKey]}
          style={itemStyle}
        >
          <InputPassword
            autoComplete={'new-password'}
            placeholder={t('createNewAiProvider.apiKey.placeholder')}
            variant={'filled'}
          />
        </Form.Item>

        <Button block htmlType={'submit'} loading={loading} type={'primary'}>
          {t('createNewAiProvider.confirm')}
        </Button>
      </Flexbox>
    </Form>
  );
});

export default CreateNewProviderContent;
