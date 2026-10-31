'use client';

import {
  Center,
  Flexbox,
  Icon,
  Input,
  Select,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { Form, useForm, useWatch } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon } from 'lucide-react';
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

const styles = stylex.create({
  sectionLabel: { fontSize: cssVar.fontSizeSM, fontWeight: 500, color: cssVar.colorTextSecondary },
  presetCard: {
    cursor: 'pointer',
    position: 'relative',
    padding: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: {
      'default': 'border-color 0.15s ease, background 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
  },
  presetCardSelected: {
    borderColor: { 'default': cssVar.colorPrimaryBorder, ':hover': cssVar.colorPrimaryBorder },
    backgroundColor: { 'default': cssVar.colorPrimaryBg, ':hover': cssVar.colorPrimaryBg },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  presetGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' },
  presetIcon: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  presetMeta: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextTertiary,
  },
  selectedMark: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    borderRadius: '999px',
    color: cssVar.colorBgContainer,
    backgroundColor: cssVar.colorPrimary,
    backgroundImage: 'none',
  },
});

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

  const [selectedPreset, setSelectedPreset] = useState<string>('custom');
  const [identifierTouched, setIdentifierTouched] = useState(false);

  const handleFinish = async (values: any) => {
    onLoadingChange?.(true);
    try {
      const result = await agentEvalService.createDataset({
        benchmarkId,
        description: values.description,
        evalConfig:
          values.evalMode === 'llm-rubric' && values.evalConfig?.judgePrompt
            ? values.evalConfig
            : undefined,
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
      toast.error(error?.message || t('dataset.create.error'));
    } finally {
      onLoadingChange?.(false);
    }
  };

  const form = useForm({ onSubmit: handleFinish });
  const nameValue = useWatch(form, 'name');
  const evalModeValue = useWatch(form, 'evalMode');

  useEffect(() => {
    if (!identifierTouched && nameValue) {
      form.setValue('identifier', toIdentifier(nameValue));
    }
  }, [nameValue, identifierTouched, form]);

  const presetsByCategory = getPresetsByCategory();
  const orderedCategories = Object.entries(presetsByCategory).filter(
    ([, presets]) => presets.length > 0,
  );

  return (
    <Form form={form} id={formId} layout="vertical">
      <Form.Field
        label={t('dataset.create.name.label')}
        name="name"
        required={t('dataset.create.nameRequired')}
      >
        <Input placeholder={t('dataset.create.name.placeholder')} />
      </Form.Field>

      <Form.Field
        label={t('dataset.create.identifier.label')}
        name="identifier"
        required={t('dataset.create.identifierRequired')}
      >
        <Input
          placeholder={t('dataset.create.identifier.placeholder')}
          style={{ fontFamily: cssVar.fontFamilyCode }}
          onChange={() => setIdentifierTouched(true)}
        />
      </Form.Field>

      <Form.Field label={t('dataset.create.description.label')} name="description">
        <TextArea placeholder={t('dataset.create.description.placeholder')} rows={3} />
      </Form.Field>

      <Form.Field extra={t('dataset.evalMode.hint')} label={t('evalMode.label')} name="evalMode">
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
            { label: t('evalMode.external'), value: 'external' },
          ]}
        />
      </Form.Field>

      {evalModeValue === 'llm-rubric' && (
        <Form.Field label={t('evalMode.prompt.label')} name="evalConfig.judgePrompt">
          <TextArea placeholder={t('evalMode.prompt.placeholder')} rows={3} />
        </Form.Field>
      )}

      {/* Preset picker — selectable cards grouped by category, the bold upgrade
          over the previous single dropdown. */}
      <Flexbox gap={12} style={{ marginBlockStart: 4 }}>
        <span {...stylex.props(styles.sectionLabel)}>{t('dataset.create.preset.label')}</span>
        {orderedCategories.map(([category, presets]) => (
          <Flexbox gap={8} key={category}>
            <Text color={cssVar.colorTextTertiary} fontSize={12}>
              {CATEGORY_LABELS[category] || category}
            </Text>
            <div {...stylex.props(styles.presetGrid)}>
              {presets.map((preset) => {
                const isSelected = selectedPreset === preset.id;
                return (
                  <div
                    aria-pressed={isSelected}
                    {...stylex.props(styles.presetCard, isSelected && styles.presetCardSelected)}
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
                      <Center
                        className={stylex.props(styles.presetIcon).className}
                        flex="none"
                        height={36}
                        width={36}
                      >
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
                        <span {...stylex.props(styles.selectedMark)}>
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

        {DATASET_PRESETS[selectedPreset] && (
          <Flexbox gap={4} style={{ marginBlockStart: 4 }}>
            <Text fontSize={12} type="secondary">
              {DATASET_PRESETS[selectedPreset].formatDescription}
            </Text>
            <Text className={stylex.props(styles.presetMeta).className}>
              <strong>Required:</strong> {DATASET_PRESETS[selectedPreset].requiredFields.join(', ')}
              {DATASET_PRESETS[selectedPreset].optionalFields.length > 0 && (
                <>
                  {' · '}
                  <strong>Optional:</strong>{' '}
                  {DATASET_PRESETS[selectedPreset].optionalFields.join(', ')}
                </>
              )}
            </Text>
          </Flexbox>
        )}
      </Flexbox>
    </Form>
  );
};

export default DatasetCreateContent;
