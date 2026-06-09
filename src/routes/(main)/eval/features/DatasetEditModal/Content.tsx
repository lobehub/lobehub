'use client';

import { Center, Flexbox, Icon, Input, Text, TextArea } from '@lobehub/ui';
import { Select, useModalContext } from '@lobehub/ui/base-ui';
import { App, Form } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';

import { DATASET_PRESETS, getPresetsByCategory } from '../../config/datasetPresets';

const CATEGORY_LABELS: Record<string, string> = {
  'custom': 'Custom',
  'memory': 'Memory',
  'reference': 'Reference Formats',
  'research': 'Deep Research / QA',
  'tool-use': 'Tool Use',
};

const styles = createStaticStyles(({ css }) => ({
  presetIcon: css`
    border: 1px solid ${cssVar.colorFillTertiary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgElevated};
  `,
}));

export interface DatasetEditContentProps {
  dataset: {
    description?: string;
    evalMode?: string | null;
    id: string;
    metadata?: Record<string, unknown>;
    name: string;
  };
  formId: string;
  onLoadingChange?: (loading: boolean) => void;
  onSuccess?: () => void;
}

const DatasetEditContent: FC<DatasetEditContentProps> = ({
  dataset,
  formId,
  onLoadingChange,
  onSuccess,
}) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [selectedPreset, setSelectedPreset] = useState<string>('custom');
  const evalModeValue = Form.useWatch('evalMode', form);

  useEffect(() => {
    if (dataset) {
      form.setFieldsValue({
        description: dataset.description || '',
        evalConfig: (dataset as any).evalConfig,
        evalMode: dataset.evalMode || undefined,
        name: dataset.name,
      });
      setSelectedPreset((dataset.metadata?.preset as string) || 'custom');
    }
  }, [dataset, form]);

  const presetsByCategory = getPresetsByCategory();

  const selectOptions = Object.entries(presetsByCategory)
    .filter(([_, presets]) => presets.length > 0)
    .map(([category, presets]) => ({
      label: CATEGORY_LABELS[category] || category,
      options: presets.map((preset) => ({
        label: preset.name,
        value: preset.id,
      })),
    }));

  const handleFinish = async (values: any) => {
    onLoadingChange?.(true);
    try {
      await agentEvalService.updateDataset({
        description: values.description?.trim() || undefined,
        evalConfig: values.evalConfig?.judgePrompt ? values.evalConfig : null,
        evalMode: values.evalMode || null,
        id: dataset.id,
        metadata: {
          ...dataset.metadata,
          preset: selectedPreset,
        },
        name: values.name.trim(),
      });
      message.success(t('dataset.edit.success'));
      close();
      onSuccess?.();
    } catch {
      message.error(t('dataset.edit.error'));
    } finally {
      onLoadingChange?.(false);
    }
  };

  return (
    <Form form={form} layout="vertical" name={formId} onFinish={handleFinish}>
      <Form.Item
        label={t('dataset.create.name.label')}
        name="name"
        rules={[{ message: t('dataset.create.nameRequired'), required: true }]}
      >
        <Input autoFocus placeholder={t('dataset.create.name.placeholder')} />
      </Form.Item>

      <Form.Item label={t('dataset.create.description.label')} name="description">
        <TextArea placeholder={t('dataset.create.description.placeholder')} rows={3} />
      </Form.Item>

      <Form.Item extra={t('dataset.evalMode.hint')} label={t('evalMode.label')} name="evalMode">
        <Select
          allowClear
          placeholder={t('evalMode.placeholder')}
          optionRender={(option) => (
            <Flexbox gap={2} style={{ padding: '4px 0' }}>
              <div>{option.label}</div>
              <Text style={{ fontSize: 12 }} type="secondary">
                {t(`evalMode.${option.value}.desc` as any)}
              </Text>
            </Flexbox>
          )}
          options={[
            { label: t('evalMode.equals'), value: 'equals' },
            { label: t('evalMode.contains'), value: 'contains' },
            { label: t('evalMode.llm-rubric'), value: 'llm-rubric' },
            { label: t('evalMode.answer-relevance'), value: 'answer-relevance' },
            { label: t('evalMode.external'), value: 'external' },
          ]}
        />
      </Form.Item>

      {(evalModeValue === 'llm-rubric' || evalModeValue === 'answer-relevance') && (
        <>
          <Form.Item initialValue="aihubmix" label={'Provider'} name={['evalConfig', 'provider']}>
            <TextArea placeholder={'LLM provider (e.g. openai, azure)'} rows={1} />
          </Form.Item>
          <Form.Item initialValue="gpt-5-nano" label={'Model'} name={['evalConfig', 'model']}>
            <TextArea placeholder={'LLM model to use for evaluation (e.g. gpt-4)'} rows={1} />
          </Form.Item>
          <Form.Item label={'System Prompt'} name={['evalConfig', 'systemRole']}>
            <TextArea placeholder={'Optional system prompt for the LLM judge'} rows={3} />
          </Form.Item>
          <Form.Item label={'Eval Prompt'} name={['evalConfig', 'criteria']}>
            <TextArea placeholder={'Prompt template for the LLM judge'} rows={3} />
          </Form.Item>
          <Form.Item label={t('evalMode.prompt.label')} name={['evalConfig', 'judgePrompt']}>
            <TextArea placeholder={t('evalMode.prompt.placeholder')} rows={3} />
          </Form.Item>
        </>
      )}

      <Form.Item label={t('dataset.create.preset.label')} style={{ marginBottom: 0 }}>
        <Select
          options={selectOptions}
          placeholder="Select a preset"
          value={selectedPreset}
          optionRender={(option) => {
            const preset = DATASET_PRESETS[option.value as string];
            if (!preset) return option.label;

            return (
              <Flexbox
                horizontal
                align="flex-start"
                gap={12}
                style={{ overflow: 'hidden', width: '100%' }}
              >
                <Center className={styles.presetIcon} flex="none" height={40} width={40}>
                  <Icon icon={preset.icon} size={18} />
                </Center>
                <Flexbox flex={1} gap={2} style={{ minWidth: 0, overflow: 'hidden' }}>
                  <Text ellipsis style={{ fontSize: 14, fontWeight: 500 }}>
                    {preset.name}
                  </Text>
                  <Text ellipsis style={{ fontSize: 12 }} type="secondary">
                    {preset.description}
                  </Text>
                </Flexbox>
              </Flexbox>
            );
          }}
          onChange={(value) => setSelectedPreset(value)}
        />
      </Form.Item>
    </Form>
  );
};

export default DatasetEditContent;
