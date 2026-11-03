'use client';

import { cssVar, Flexbox, Icon } from '@lobehub/ui';
import {
  Button,
  confirmModal,
  createModal,
  Input,
  ModalFooter,
  type ModalInstance,
  Select,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { t as i18nT } from 'i18next';
import { BrainIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ProviderIcon } from '@/components/LobeIcons';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAiInfraStore } from '@/store/aiInfra/store';
import { type AiProviderDetailItem, type UpdateAiProviderParams } from '@/types/aiProvider';

import { CUSTOM_PROVIDER_SDK_OPTIONS } from '../../customProviderSdkOptions';
import { isResponsesApiSupportedSdkType, normalizeProviderSettings } from '../../providerSettings';

interface SettingContentProps {
  id: string;
  initialValues: AiProviderDetailItem;
}

const SectionTitle = memo<{ children: ReactNode }>(({ children }) => (
  <Text fontSize={13} type={'secondary'} weight={500}>
    {children}
  </Text>
));

SectionTitle.displayName = 'SectionTitle';

const itemStyle = { paddingBlock: 0 };

const SettingContent = memo<SettingContentProps>(({ initialValues, id }) => {
  const { t } = useTranslation(['modelProvider', 'common']);
  const [loading, setLoading] = useState(false);
  const [updateAiProvider, deleteAiProvider] = useAiInfraStore((s) => [
    s.updateAiProvider,
    s.deleteAiProvider,
  ]);

  const navigate = useWorkspaceAwareNavigate();
  const { close } = useModalContext();

  const onFinish = async (values: UpdateAiProviderParams) => {
    setLoading(true);

    try {
      const finalValues: UpdateAiProviderParams = {
        ...values,
        settings: normalizeProviderSettings({
          nextSettings: values.settings,
          previousSettings: initialValues.settings,
        }) as UpdateAiProviderParams['settings'],
      };

      const nextSdkType = finalValues.settings?.sdkType;
      if (nextSdkType && !isResponsesApiSupportedSdkType(nextSdkType)) {
        const previousConfig = (initialValues as { config?: UpdateAiProviderParams['config'] })
          .config;

        finalValues.config = {
          ...previousConfig,
          ...finalValues.config,
          enableResponseApi: false,
        };
      }

      await updateAiProvider(id, finalValues);
      setLoading(false);
      toast.success(t('updateAiProvider.updateSuccess'));
      close();
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const form = useForm<UpdateAiProviderParams>({
    initialValues: initialValues as UpdateAiProviderParams,
    onSubmit: ({ description, logo, name, settings }) =>
      onFinish({ description, logo, name, settings }),
  });

  const handleDelete = () => {
    confirmModal({
      content: t('updateAiProvider.confirmDeleteDescription'),
      okButtonProps: { danger: true },
      okText: t('delete', { ns: 'common' }),
      onOk: async () => {
        await deleteAiProvider(id);
        navigate('/settings/provider/all');
        close();
        toast.success(t('updateAiProvider.deleteSuccess'));
      },
      title: t('updateAiProvider.confirmDelete'),
    });
  };

  return (
    <Flexbox>
      <Form form={form} layout={'vertical'}>
        <Flexbox gap={16}>
          <SectionTitle>{t('createNewAiProvider.basicTitle')}</SectionTitle>

          <Form.Field label={t('createNewAiProvider.id.title')} style={itemStyle}>
            <Text type={'secondary'}>{initialValues.id}</Text>
          </Form.Field>

          <Form.Field
            label={t('createNewAiProvider.name.title')}
            name={'name'}
            required={t('createNewAiProvider.name.required')}
            style={itemStyle}
          >
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
            <Input allowClear placeholder={'https://logo-url'} variant={'filled'} />
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
        </Flexbox>
      </Form>
      <ModalFooter
        style={{
          borderBlockStart: `1px solid ${cssVar.colorBorderSecondary}`,
          marginTop: 16,
          padding: 0,
        }}
      >
        <Button danger disabled={loading} onClick={handleDelete}>
          {t('delete', { ns: 'common' })}
        </Button>
        <Button loading={loading} type={'primary'} onClick={() => form.submit()}>
          {t('update', { ns: 'common' })}
        </Button>
      </ModalFooter>
    </Flexbox>
  );
});

SettingContent.displayName = 'SettingContent';

export const createSettingModal = (props: SettingContentProps): ModalInstance =>
  createModal({
    content: <SettingContent {...props} />,
    footer: null,
    maskClosable: true,

    title: (
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon icon={BrainIcon} />
        {i18nT('updateCustomAiProvider.title', { ns: 'modelProvider' })}
      </Flexbox>
    ),
    width: 'min(90vw, 640px)',
  });
