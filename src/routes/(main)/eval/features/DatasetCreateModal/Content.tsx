'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Select, useModalContext } from '@lobehub/ui/base-ui';
import { App, Form, Input } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';

import { DATASET_PRESETS, getPresetsByCategory } from '../../config/datasetPresets';

const toIdentifier = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, '-')
    .replaceAll(/[^\da-z-]/g, '');

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

export interface DatasetCreateContentProps {
  benchmarkId: string;
  formId: string;
  onLoadingChange?: (loading: boolean) => void;
  onSuccess?: (dataset: { id: string; name: string; preset: string }) => void;
}

const DatasetCreateContent: FC<DatasetCreateContentProps> = ({
  benchmarkId,
  formId,
  onLoadingChange,
  onSuccess,
}) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [selectedPreset, setSelectedPreset] = useState<string>('custom');
  const [identifierTouched, setIdentifierTouched] = useState(false);

  const nameValue = Form.useWatch('name', form);
  const evalModeValue = Form.useWatch('evalMode', form);

  useEffect(() => {
    if (!identifierTouched && nameValue) {
      form.setFieldValue('identifier', toIdentifier(nameValue));
    }
  }, [nameValue, identifierTouched, form]);

  const handleFinish = async (values: any) => {
    onLoadingChange?.(true);
    try {
      const result = await agentEvalService.createDataset({
        benchmarkId,
        description: values.description,
        evalConfig: values.evalConfig?.judgePrompt ? values.evalConfig : undefined,
        evalMode: values.evalMode || undefined,
        identifier: values.identifier.trim(),
        metadata: {
          preset: selectedPreset,
        },
        name: values.name,
      });
      close();
      onSuccess?.({
        id: result.id,
        name: result.name,
        preset: selectedPreset,
      });
    } catch (error: any) {
      message.error(error?.message || t('dataset.create.error'));
    } finally {
      onLoadingChange?.(false);
    }
  };

  const presetsByCategory = getPresetsByCategory();
  const currentPreset = DATASET_PRESETS[selectedPreset];

  const selectOptions = Object.entries(presetsByCategory)
    .filter(([_, presets]) => presets.length > 0)
    .map(([category, presets]) => ({
      label: CATEGORY_LABELS[category] || category,
      options: presets.map((preset) => ({
        label: preset.name,
        value: preset.id,
      })),
    }));

  return (
    <Form form={form} layout="vertical" name={formId} onFinish={handleFinish}>
      <Form.Item
        label={t('dataset.create.name.label')}
        name="name"
        rules={[{ message: t('dataset.create.nameRequired'), required: true }]}
      >
        <Input placeholder={t('dataset.create.name.placeholder')} />
      </Form.Item>

      <Form.Item
        label={t('dataset.create.identifier.label')}
        name="identifier"
        rules={[{ message: t('dataset.create.identifierRequired'), required: true }]}
      >
        <Input
          placeholder={t('dataset.create.identifier.placeholder')}
          onChange={() => setIdentifierTouched(true)}
        />
      </Form.Item>

      <Form.Item label={t('dataset.create.description.label')} name="description">
        <Input.TextArea placeholder={t('dataset.create.description.placeholder')} rows={3} />
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
            { label: t('evalMode.external'), value: 'external' },
          ]}
        />
      </Form.Item>

      {evalModeValue === 'llm-rubric' && (
        <Form.Item label={t('evalMode.prompt.label')} name={['evalConfig', 'judgePrompt']}>
          <Input.TextArea placeholder={t('evalMode.prompt.placeholder')} rows={3} />
        </Form.Item>
      )}

      <Form.Item
        label={t('dataset.create.preset.label')}
        extra={
          currentPreset ? (
            <Flexbox gap={4} style={{ marginTop: 8 }}>
              <p style={{ color: cssVar.colorTextSecondary, fontSize: 12, margin: 0 }}>
                {currentPreset.formatDescription}
              </p>
              <div style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
                <strong>Required:</strong> {currentPreset.requiredFields.join(', ')}
                {currentPreset.optionalFields.length > 0 && (
                  <>
                    {' · '}
                    <strong>Optional:</strong> {currentPreset.optionalFields.join(', ')}
                  </>
                )}
              </div>
            </Flexbox>
          ) : null
        }
      >
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

export default DatasetCreateContent;
