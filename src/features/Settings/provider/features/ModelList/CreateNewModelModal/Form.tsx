import { Checkbox, Input, Select } from '@lobehub/ui';
import { Form, type FormInstance, type FormValues, useForm, useWatch } from '@lobehub/ui/form';
import type { AiModelType, AiProviderModelListItem } from 'model-bank';
import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import MaxTokenSlider from '@/components/MaxTokenSlider';
import { type ChatModelCard } from '@/types/llm';

import ExtendParamsSelect from './ExtendParamsSelect';
import TTSVoiceSelect from './TTSVoiceSelect';
import { CUSTOM_MODEL_TYPES, hasDuplicateModelId } from './utils';

interface ModelConfigFormProps {
  disabled?: boolean;
  existingModelIds?: string[];
  idEditable?: boolean;
  initialValues?: ChatModelCard & Pick<AiProviderModelListItem, 'parameters' | 'voices'>;
  onFormInstanceReady: (instance: FormInstance) => void;
  showDeployName?: boolean;
  type?: AiModelType;
}

const ModelConfigForm = memo<ModelConfigFormProps>(
  ({
    showDeployName,
    idEditable = true,
    onFormInstanceReady,
    initialValues,
    disabled,
    existingModelIds = [],
    type,
  }) => {
    const { t } = useTranslation('modelProvider');

    const formInstance = useForm<FormValues>({ initialValues });
    // Follow the type picked in the form, so choosing `tts` while creating or editing a
    // model shows the voice field right away.
    const currentType = (useWatch(formInstance, 'type') as AiModelType | undefined) ?? type;

    const modelTypeOptions = useMemo(
      () =>
        CUSTOM_MODEL_TYPES.map((value) => {
          const label = t(`providerModels.item.modelConfig.type.options.${value}`);

          return {
            label: label !== value ? `${label} (${value})` : label,
            value,
          };
        }),
      [t],
    );

    useEffect(() => {
      onFormInstanceReady(formInstance);
    }, []);

    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
        }}
      >
        <Form form={formInstance} layout={'vertical'} style={{ marginTop: 16 }}>
          <Form.Field
            required
            extra={t('providerModels.item.modelConfig.id.extra')}
            label={t('providerModels.item.modelConfig.id.title')}
            name={'id'}
            validate={(value?: string) =>
              hasDuplicateModelId(value, existingModelIds)
                ? t('providerModels.item.modelConfig.id.duplicate')
                : undefined
            }
          >
            <Input
              disabled={disabled || !idEditable}
              placeholder={t('providerModels.item.modelConfig.id.placeholder')}
            />
          </Form.Field>
          {showDeployName && (
            <Form.Field
              extra={t('providerModels.item.modelConfig.deployName.extra')}
              label={t('providerModels.item.modelConfig.deployName.title')}
              name={'config.deploymentName'}
            >
              <Input
                disabled={disabled}
                placeholder={t('providerModels.item.modelConfig.deployName.placeholder')}
              />
            </Form.Field>
          )}
          <Form.Field
            label={t('providerModels.item.modelConfig.displayName.title')}
            name={'displayName'}
          >
            <Input
              disabled={disabled}
              placeholder={t('providerModels.item.modelConfig.displayName.placeholder')}
            />
          </Form.Field>
          {currentType === 'tts' && (
            <Form.Field
              extra={t('providerModels.item.modelConfig.ttsVoice.extra')}
              label={t('providerModels.item.modelConfig.ttsVoice.title')}
              name={'settings.ttsVoice'}
            >
              <TTSVoiceSelect
                disabled={disabled}
                voices={initialValues?.voices}
                defaultVoice={
                  (initialValues?.parameters as { voice?: { default?: string } } | undefined)?.voice
                    ?.default
                }
              />
            </Form.Field>
          )}
          <Form.Field
            extra={t('providerModels.item.modelConfig.tokens.extra')}
            label={t('providerModels.item.modelConfig.tokens.title')}
            name={'contextWindowTokens'}
          >
            <MaxTokenSlider />
          </Form.Field>
          <Form.Field
            extra={t('providerModels.item.modelConfig.extendParams.extra')}
            label={t('providerModels.item.modelConfig.extendParams.title')}
            name={'settings.extendParams'}
          >
            <ExtendParamsSelect />
          </Form.Field>
          <Form.Field
            desc={t('providerModels.item.modelConfig.functionCall.extra')}
            label={t('providerModels.item.modelConfig.functionCall.title')}
            layout={'horizontal'}
            name={'abilities.functionCall'}
          >
            <Checkbox disabled={disabled} />
          </Form.Field>
          <Form.Field
            desc={t('providerModels.item.modelConfig.vision.extra')}
            label={t('providerModels.item.modelConfig.vision.title')}
            layout={'horizontal'}
            name={'abilities.vision'}
          >
            <Checkbox disabled={disabled} />
          </Form.Field>
          <Form.Field
            desc={t('providerModels.item.modelConfig.reasoning.extra')}
            label={t('providerModels.item.modelConfig.reasoning.title')}
            layout={'horizontal'}
            name={'abilities.reasoning'}
          >
            <Checkbox disabled={disabled} />
          </Form.Field>
          <Form.Field
            desc={t('providerModels.item.modelConfig.search.extra')}
            label={t('providerModels.item.modelConfig.search.title')}
            layout={'horizontal'}
            name={'abilities.search'}
          >
            <Checkbox disabled={disabled} />
          </Form.Field>

          <Form.Field
            desc={t('providerModels.item.modelConfig.imageOutput.extra')}
            label={t('providerModels.item.modelConfig.imageOutput.title')}
            layout={'horizontal'}
            name={'abilities.imageOutput'}
          >
            <Checkbox disabled={disabled} />
          </Form.Field>
          <Form.Field
            desc={t('providerModels.item.modelConfig.video.extra')}
            label={t('providerModels.item.modelConfig.video.title')}
            layout={'horizontal'}
            name={'abilities.video'}
          >
            <Checkbox disabled={disabled} />
          </Form.Field>
          <Form.Field
            extra={t('providerModels.item.modelConfig.type.extra')}
            label={t('providerModels.item.modelConfig.type.title')}
            name={'type'}
          >
            <Select
              disabled={disabled}
              options={modelTypeOptions}
              placeholder={t('providerModels.item.modelConfig.type.placeholder')}
            />
          </Form.Field>
          {/*<Form.Item*/}
          {/*  extra={t('providerModels.item.modelConfig.files.extra')}*/}
          {/*  label={t('providerModels.item.modelConfig.files.title')}*/}
          {/*  name={['abilities', 'files']}*/}
          {/*  valuePropName={'checked'}*/}
          {/*>*/}
          {/*  <Checkbox />*/}
          {/*</Form.Item>*/}
        </Form>
      </div>
    );
  },
);
export default ModelConfigForm;
