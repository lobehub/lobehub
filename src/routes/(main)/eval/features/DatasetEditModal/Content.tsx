'use client';

import { Center, Flexbox, Icon, Input, Text, TextArea } from '@lobehub/ui';
import { Select, useModalContext } from '@lobehub/ui/base-ui';
import { App, Form } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckIcon } from 'lucide-react';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';

import { getPresetsByCategory } from '../../config/datasetPresets';

const CATEGORY_LABELS: Record<string, string> = {
  'custom': 'Custom',
  'memory': 'Memory',
  'reference': 'Reference Formats',
  'research': 'Deep Research / QA',
  'tool-use': 'Tool Use',
};

const styles = createStaticStyles(({ css }) => ({
  sectionLabel: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  presetCard: css`
    cursor: pointer;

    position: relative;

    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};

    transition:
      border-color 0.15s ease,
      background 0.15s ease;

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  presetCardSelected: css`
    border-color: ${cssVar.colorPrimaryBorder};
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      border-color: ${cssVar.colorPrimaryBorder};
      background: ${cssVar.colorPrimaryBg};
    }
  `,
  presetGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  `,
  presetIcon: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgElevated};
  `,
  selectedMark: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border-radius: 999px;

    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorPrimary};
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
  const orderedCategories = Object.entries(presetsByCategory).filter(
    ([, presets]) => presets.length > 0,
  );

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
            <Flexbox gap={4} style={{ paddingBlock: 4 }}>
              <div>{option.label}</div>
              <Text fontSize={12} type="secondary">
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

      {/* Preset picker — selectable cards grouped by category. */}
      <Flexbox gap={12} style={{ marginBlockStart: 4 }}>
        <span className={styles.sectionLabel}>{t('dataset.create.preset.label')}</span>
        {orderedCategories.map(([category, presets]) => (
          <Flexbox gap={8} key={category}>
            <Text color={cssVar.colorTextTertiary} fontSize={12}>
              {CATEGORY_LABELS[category] || category}
            </Text>
            <div className={styles.presetGrid}>
              {presets.map((preset) => {
                const isSelected = selectedPreset === preset.id;
                return (
                  <div
                    aria-pressed={isSelected}
                    className={`${styles.presetCard} ${isSelected ? styles.presetCardSelected : ''}`}
                    key={preset.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedPreset(preset.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedPreset(preset.id);
                      }
                    }}
                  >
                    <Flexbox horizontal align="flex-start" gap={12}>
                      <Center className={styles.presetIcon} flex="none" height={36} width={36}>
                        <Icon icon={preset.icon} size={18} />
                      </Center>
                      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                        <Text ellipsis weight={500}>
                          {preset.name}
                        </Text>
                        <Text ellipsis color={cssVar.colorTextTertiary} fontSize={12}>
                          {preset.description}
                        </Text>
                      </Flexbox>
                      {isSelected && (
                        <span className={styles.selectedMark}>
                          <Icon icon={CheckIcon} size={12} />
                        </span>
                      )}
                    </Flexbox>
                  </div>
                );
              })}
            </div>
          </Flexbox>
        ))}
      </Flexbox>
    </Form>
  );
};

export default DatasetEditContent;
