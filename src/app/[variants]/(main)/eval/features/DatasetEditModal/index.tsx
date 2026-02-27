'use client';

import { Center, Flexbox, Icon, Input, Modal, type ModalProps, Text, TextArea } from '@lobehub/ui';
import { App, Form, Select } from 'antd';
import { cssVar } from 'antd-style';
import { memo, useEffect, useState } from 'react';
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

interface DatasetEditModalProps extends ModalProps {
  dataset: {
    description?: string;
    evalMode?: string | null;
    id: string;
    metadata?: Record<string, unknown>;
    name: string;
  };
  onSuccess?: () => void;
}

const DatasetEditModal = memo<DatasetEditModalProps>(({ open, onCancel, dataset, onSuccess }) => {
  const { t } = useTranslation('eval');
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('custom');
  const evalModeValue = Form.useWatch('evalMode', form);

  useEffect(() => {
    if (open && dataset) {
      form.setFieldsValue({
        description: dataset.description || '',
        evalConfig: (dataset as any).evalConfig,
        evalMode: dataset.evalMode || undefined,
        name: dataset.name,
      });
      setSelectedPreset((dataset.metadata?.preset as string) || 'custom');
    }
  }, [open, dataset, form]);

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

  return (
    <Modal
      allowFullscreen
      destroyOnHidden
      okButtonProps={{ loading }}
      okText={t('common.update')}
      open={open}
      title={t('dataset.edit.title')}
      width={480}
      onCancel={(e) => {
        form.resetFields();
        onCancel?.(e);
      }}
      onOk={async (e) => {
        try {
          const values = await form.validateFields();
          setLoading(true);

          await agentEvalService.updateDataset({
            id: dataset.id,
            name: values.name.trim(),
            description: values.description?.trim() || undefined,
            evalConfig: values.evalConfig?.judgePrompt ? values.evalConfig : null,
            evalMode: values.evalMode || null,
            metadata: {
              ...dataset.metadata,
              preset: selectedPreset,
            },
          });
          message.success(t('dataset.edit.success'));
          form.resetFields();
          onCancel?.(e);
          onSuccess?.();
        } catch (error: any) {
          if (error?.errorFields) return;
          message.error(t('dataset.edit.error'));
        } finally {
          setLoading(false);
        }
      }}
    >
      <Form form={form} layout="vertical" style={{ paddingBlock: 16 }}>
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
            ]}
          />
        </Form.Item>

        {evalModeValue === 'llm-rubric' && (
          <Form.Item label={t('evalMode.prompt.label')} name={['evalConfig', 'judgePrompt']}>
            <TextArea placeholder={t('evalMode.prompt.placeholder')} rows={3} />
          </Form.Item>
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
                  <Center
                    flex="none"
                    height={40}
                    width={40}
                    style={{
                      background: cssVar.colorBgElevated,
                      border: `1px solid ${cssVar.colorFillTertiary}`,
                      borderRadius: cssVar.borderRadius,
                    }}
                  >
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
    </Modal>
  );
});

export default DatasetEditModal;
