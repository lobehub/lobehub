'use client';

import { Center, Flexbox, Icon, Modal, Text } from '@lobehub/ui';
import { App, Form, Input, Select } from 'antd';
import { cssVar } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';

import { DATASET_PRESETS, getPresetsByCategory } from '../../config/datasetPresets';

const toIdentifier = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, '-')
    .replaceAll(/[^\da-z-]/g, '');

interface DatasetCreateModalProps {
  benchmarkId: string;
  onClose: () => void;
  onSuccess?: (dataset: { id: string; name: string; preset: string }) => void;
  open: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  'research': 'Deep Research / QA',
  'tool-use': 'Tool Use',
  'memory': 'Memory',
  'reference': 'Reference Formats',
  'custom': 'Custom',
};

const DatasetCreateModal = memo<DatasetCreateModalProps>(
  ({ open, onClose, benchmarkId, onSuccess }) => {
    const { t } = useTranslation('eval');
    const { message } = App.useApp();
    const [form] = Form.useForm();

    const [loading, setLoading] = useState(false);
    const [selectedPreset, setSelectedPreset] = useState<string>('custom');
    const [identifierTouched, setIdentifierTouched] = useState(false);

    const nameValue = Form.useWatch('name', form);
    const evalModeValue = Form.useWatch('evalMode', form);

    useEffect(() => {
      if (!identifierTouched && nameValue) {
        form.setFieldValue('identifier', toIdentifier(nameValue));
      }
    }, [nameValue, identifierTouched, form]);

    const handleClose = () => {
      form.resetFields();
      setSelectedPreset('custom');
      setIdentifierTouched(false);
      onClose();
    };

    const handleCreate = async () => {
      try {
        const values = await form.validateFields();
        setLoading(true);

        const result = await agentEvalService.createDataset({
          benchmarkId,
          identifier: values.identifier.trim(),
          name: values.name,
          description: values.description,
          evalConfig: values.evalConfig?.judgePrompt ? values.evalConfig : undefined,
          evalMode: values.evalMode || undefined,
          metadata: {
            preset: selectedPreset,
          },
        });

        handleClose();
        onSuccess?.({
          id: result.id,
          name: result.name,
          preset: selectedPreset,
        });
      } catch (error: any) {
        if (error.errorFields) {
          // Validation error, do nothing
          return;
        }
        message.error(error.message || t('dataset.create.error'));
      } finally {
        setLoading(false);
      }
    };

    const presetsByCategory = getPresetsByCategory();
    const currentPreset = DATASET_PRESETS[selectedPreset];

    // 构建分组选项
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
        destroyOnHidden
        okButtonProps={{ loading }}
        okText={t('common.create')}
        open={open}
        title={t('dataset.create.title')}
        width={600}
        onCancel={handleClose}
        onOk={handleCreate}
      >
        <Form form={form} layout="vertical" style={{ paddingBlock: 16 }}>
          <Form.Item
            label={t('dataset.create.name.label')}
            name="name"
            rules={[{ required: true, message: t('dataset.create.nameRequired') }]}
          >
            <Input placeholder={t('dataset.create.name.placeholder')} />
          </Form.Item>

          <Form.Item
            label={t('dataset.create.identifier.label')}
            name="identifier"
            rules={[{ required: true, message: t('dataset.create.identifierRequired') }]}
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
                  <p style={{ color: 'var(--ant-color-text-secondary)', fontSize: 12, margin: 0 }}>
                    {currentPreset.formatDescription}
                  </p>
                  <div style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>
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
                    <Center
                      flex="none"
                      height={40}
                      width={40}
                      style={{
                        border: `1px solid ${cssVar.colorFillTertiary}`,
                        borderRadius: cssVar.borderRadius,
                        background: cssVar.colorBgElevated,
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
  },
);

export default DatasetCreateModal;
