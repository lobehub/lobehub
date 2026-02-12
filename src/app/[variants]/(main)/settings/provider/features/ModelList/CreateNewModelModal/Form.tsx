import { Input } from '@lobehub/ui';
import { type FormInstance } from 'antd';
import { Checkbox, Form, Select } from 'antd';
import { type AiModelType } from 'model-bank';
import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import MaxTokenSlider from '@/components/MaxTokenSlider';
import { useIsMobile } from '@/hooks/useIsMobile';
import { type ChatModelCard } from '@/types/llm';

import ExtendParamsSelect from './ExtendParamsSelect';

interface ModelConfigFormProps {
  idEditable?: boolean;
  initialValues?: ChatModelCard;
  onFormInstanceReady: (instance: FormInstance) => void;
  showDeployName?: boolean;
  type?: AiModelType;
}

const ModelConfigForm = memo<ModelConfigFormProps>(
  ({ showDeployName, idEditable = true, onFormInstanceReady, initialValues }) => {
    const { t } = useTranslation('modelProvider');

    const [formInstance] = Form.useForm();

    const isMobile = useIsMobile();

    const modelTypeOptions = useMemo(
      () =>
        (
          [
            'chat',
            'embedding',
            'tts',
            'stt',
            'image',
            // 'text2video',
            // 'text2music',
            'realtime',
          ] as AiModelType[]
        ).map((value) => {
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
        <Form
          colon={false}
          form={formInstance}
          initialValues={initialValues}
          labelCol={{ span: 4 }}
          style={{ marginTop: 16 }}
          wrapperCol={isMobile ? { span: 18 } : { offset: 1, span: 18 }}
        >
          <Form.Item
            extra={t('providerModels.item.modelConfig.id.extra')}
            label={t('providerModels.item.modelConfig.id.title')}
            name={'id'}
            rules={[{ required: true }]}
          >
            <Input
              disabled={!idEditable}
              placeholder={t('providerModels.item.modelConfig.id.placeholder')}
            />
          </Form.Item>
          {showDeployName && (
            <Form.Item
              extra={t('providerModels.item.modelConfig.deployName.extra')}
              label={t('providerModels.item.modelConfig.deployName.title')}
              name={['config', 'deploymentName']}
            >
              <Input placeholder={t('providerModels.item.modelConfig.deployName.placeholder')} />
            </Form.Item>
          )}
          <Form.Item
            label={t('providerModels.item.modelConfig.displayName.title')}
            name={'displayName'}
          >
            <Input placeholder={t('providerModels.item.modelConfig.displayName.placeholder')} />
          </Form.Item>
          <Form.Item
            extra={t('providerModels.item.modelConfig.tokens.extra')}
            label={t('providerModels.item.modelConfig.tokens.title')}
            name={'contextWindowTokens'}
          >
            <MaxTokenSlider />
          </Form.Item>
          <Form.Item
            extra={t('providerModels.item.modelConfig.extendParams.extra')}
            label={t('providerModels.item.modelConfig.extendParams.title')}
            name={['settings', 'extendParams']}
          >
            <ExtendParamsSelect />
          </Form.Item>
          <Form.Item
            extra={t('providerModels.item.modelConfig.functionCall.extra')}
            label={t('providerModels.item.modelConfig.functionCall.title')}
            name={['abilities', 'functionCall']}
            valuePropName={'checked'}
          >
            <Checkbox />
          </Form.Item>
          <Form.Item
            extra={t('providerModels.item.modelConfig.vision.extra')}
            label={t('providerModels.item.modelConfig.vision.title')}
            name={['abilities', 'vision']}
            valuePropName={'checked'}
          >
            <Checkbox />
          </Form.Item>
          <Form.Item
            extra={t('providerModels.item.modelConfig.reasoning.extra')}
            label={t('providerModels.item.modelConfig.reasoning.title')}
            name={['abilities', 'reasoning']}
            valuePropName={'checked'}
          >
            <Checkbox />
          </Form.Item>
          <Form.Item
            extra={t('providerModels.item.modelConfig.search.extra')}
            label={t('providerModels.item.modelConfig.search.title')}
            name={['abilities', 'search']}
            valuePropName={'checked'}
          >
            <Checkbox />
          </Form.Item>

          <Form.Item
            extra={t('providerModels.item.modelConfig.imageOutput.extra')}
            label={t('providerModels.item.modelConfig.imageOutput.title')}
            name={['abilities', 'imageOutput']}
            valuePropName={'checked'}
          >
            <Checkbox />
          </Form.Item>
          <Form.Item
            extra={t('providerModels.item.modelConfig.video.extra')}
            label={t('providerModels.item.modelConfig.video.title')}
            name={['abilities', 'video']}
            valuePropName={'checked'}
          >
            <Checkbox />
          </Form.Item>
          <Form.Item
            extra={t('providerModels.item.modelConfig.type.extra')}
            label={t('providerModels.item.modelConfig.type.title')}
            name={'type'}
          >
            <Select
              options={modelTypeOptions}
              placeholder={t('providerModels.item.modelConfig.type.placeholder')}
            />
          </Form.Item>
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
