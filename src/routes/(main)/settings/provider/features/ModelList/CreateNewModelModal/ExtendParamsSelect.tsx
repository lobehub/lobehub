import { Flexbox } from '@lobehub/ui';
import { Popover, Select, Space, Switch, Tag, theme, Typography } from 'antd';
import { type ExtendParamsType } from 'model-bank';
import { type ReactNode } from 'react';
import { memo, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import EffortSlider from '@/features/ModelSwitchPanel/components/ControlsForm/EffortSlider';
import GPT5ReasoningEffortSlider from '@/features/ModelSwitchPanel/components/ControlsForm/GPT5ReasoningEffortSlider';
import GPT51ReasoningEffortSlider from '@/features/ModelSwitchPanel/components/ControlsForm/GPT51ReasoningEffortSlider';
import GPT52ProReasoningEffortSlider from '@/features/ModelSwitchPanel/components/ControlsForm/GPT52ProReasoningEffortSlider';
import GPT52ReasoningEffortSlider from '@/features/ModelSwitchPanel/components/ControlsForm/GPT52ReasoningEffortSlider';
import ImageAspectRatio2Select from '@/features/ModelSwitchPanel/components/ControlsForm/ImageAspectRatio2Select';
import ImageAspectRatioSelect from '@/features/ModelSwitchPanel/components/ControlsForm/ImageAspectRatioSelect';
import ImageResolution2Slider from '@/features/ModelSwitchPanel/components/ControlsForm/ImageResolution2Slider';
import ImageResolutionSlider from '@/features/ModelSwitchPanel/components/ControlsForm/ImageResolutionSlider';
import ReasoningEffortSlider from '@/features/ModelSwitchPanel/components/ControlsForm/ReasoningEffortSlider';
import ReasoningTokenSlider from '@/features/ModelSwitchPanel/components/ControlsForm/ReasoningTokenSlider';
import TextVerbositySlider from '@/features/ModelSwitchPanel/components/ControlsForm/TextVerbositySlider';
import ThinkingBudgetSlider from '@/features/ModelSwitchPanel/components/ControlsForm/ThinkingBudgetSlider';
import ThinkingLevel2Slider from '@/features/ModelSwitchPanel/components/ControlsForm/ThinkingLevel2Slider';
import ThinkingLevel3Slider from '@/features/ModelSwitchPanel/components/ControlsForm/ThinkingLevel3Slider';
import ThinkingLevel4Slider from '@/features/ModelSwitchPanel/components/ControlsForm/ThinkingLevel4Slider';
import ThinkingLevelSlider from '@/features/ModelSwitchPanel/components/ControlsForm/ThinkingLevelSlider';
import ThinkingSlider from '@/features/ModelSwitchPanel/components/ControlsForm/ThinkingSlider';

type ExtendParamsOption = {
  hintKey: string;
  key: ExtendParamsType;
};

const EXTEND_PARAMS_OPTIONS: ExtendParamsOption[] = [
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.disableContextCaching.hint',
    key: 'disableContextCaching',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.enableReasoning.hint',
    key: 'enableReasoning',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.enableAdaptiveThinking.hint',
    key: 'enableAdaptiveThinking',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.reasoningBudgetToken.hint',
    key: 'reasoningBudgetToken',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.effort.hint',
    key: 'effort',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.reasoningEffort.hint',
    key: 'reasoningEffort',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.gpt5ReasoningEffort.hint',
    key: 'gpt5ReasoningEffort',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.gpt5_1ReasoningEffort.hint',
    key: 'gpt5_1ReasoningEffort',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.gpt5_2ReasoningEffort.hint',
    key: 'gpt5_2ReasoningEffort',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.gpt5_2ProReasoningEffort.hint',
    key: 'gpt5_2ProReasoningEffort',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.textVerbosity.hint',
    key: 'textVerbosity',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.thinking.hint',
    key: 'thinking',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.thinkingBudget.hint',
    key: 'thinkingBudget',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.thinkingLevel.hint',
    key: 'thinkingLevel',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.thinkingLevel2.hint',
    key: 'thinkingLevel2',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.thinkingLevel3.hint',
    key: 'thinkingLevel3',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.thinkingLevel4.hint',
    key: 'thinkingLevel4',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.urlContext.hint',
    key: 'urlContext',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.imageAspectRatio.hint',
    key: 'imageAspectRatio',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.imageAspectRatio2.hint',
    key: 'imageAspectRatio2',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.imageResolution.hint',
    key: 'imageResolution',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.imageResolution2.hint',
    key: 'imageResolution2',
  },
];

// Map variant keys to their base i18n title key (synced with ControlsForm.tsx)
// This allows reusing existing i18n translations instead of adding new ones
const TITLE_KEY_ALIASES: Partial<Record<ExtendParamsType, ExtendParamsType>> = {
  gpt5ReasoningEffort: 'reasoningEffort',
  gpt5_1ReasoningEffort: 'reasoningEffort',
  gpt5_2ProReasoningEffort: 'reasoningEffort',
  gpt5_2ReasoningEffort: 'reasoningEffort',
  imageAspectRatio2: 'imageAspectRatio',
  thinkingLevel2: 'thinkingLevel',
  thinkingLevel3: 'thinkingLevel',
  thinkingLevel4: 'thinkingLevel',
};

type PreviewMeta = {
  labelOverride?: string;
  labelSuffix?: string;
  previewWidth?: number;
  tag?: string;
};

const PREVIEW_META: Partial<Record<ExtendParamsType, PreviewMeta>> = {
  disableContextCaching: { labelSuffix: ' (Claude)', previewWidth: 400 },
  effort: { labelSuffix: ' (Opus 4.6)', previewWidth: 280, tag: 'output_config.effort' },
  enableAdaptiveThinking: {
    labelSuffix: ' (Opus 4.6)',
    previewWidth: 300,
    tag: 'thinking.type',
  },
  enableReasoning: { previewWidth: 300, tag: 'thinking.type' },
  gpt5ReasoningEffort: { previewWidth: 300, tag: 'reasoning_effort' },
  gpt5_1ReasoningEffort: { labelSuffix: ' (GPT-5.1)', previewWidth: 300, tag: 'reasoning_effort' },
  gpt5_2ProReasoningEffort: {
    labelSuffix: ' (GPT-5.2 Pro)',
    previewWidth: 300,
    tag: 'reasoning_effort',
  },
  gpt5_2ReasoningEffort: { labelSuffix: ' (GPT-5.2)', previewWidth: 300, tag: 'reasoning_effort' },
  imageAspectRatio: { labelSuffix: '', previewWidth: 350, tag: 'aspect_ratio' },
  imageAspectRatio2: { labelSuffix: ' (Nano Banana 2)', previewWidth: 350, tag: 'aspect_ratio' },
  imageResolution: { labelSuffix: '', previewWidth: 250, tag: 'resolution' },
  imageResolution2: { labelSuffix: ' (512px+)', previewWidth: 280, tag: 'resolution' },
  reasoningBudgetToken: { previewWidth: 350, tag: 'thinking.budget_tokens' },
  reasoningEffort: { previewWidth: 250, tag: 'reasoning_effort' },
  textVerbosity: { labelSuffix: '', previewWidth: 250, tag: 'text_verbosity' },
  thinking: { labelSuffix: ' (Doubao)', previewWidth: 300, tag: 'thinking.type' },
  thinkingBudget: { labelSuffix: ' (Gemini)', previewWidth: 500, tag: 'thinkingBudget' },
  thinkingLevel: { labelSuffix: ' (3 Flash)', previewWidth: 280, tag: 'thinkingLevel' },
  thinkingLevel2: { labelSuffix: ' (3 Pro)', previewWidth: 200, tag: 'thinkingLevel' },
  thinkingLevel3: { labelSuffix: ' (Gemini 3.1)', previewWidth: 200, tag: 'thinkingLevel' },
  thinkingLevel4: { labelSuffix: ' (Nano Banana 2)', previewWidth: 200, tag: 'thinkingLevel' },
  urlContext: { labelSuffix: ' (Gemini)', previewWidth: 400, tag: 'urlContext' },
};

type ExtendParamsDefinition = {
  desc?: ReactNode;
  hint: string;
  key: ExtendParamsType;
  label: string;
  parameterTag?: string;
  preview?: ReactNode;
  previewWidth?: number;
};

interface ExtendParamsSelectProps {
  onChange?: (value: ExtendParamsType[] | undefined) => void;
  value?: ExtendParamsType[];
}

const PreviewContent = ({
  desc,
  hint,
  label,
  preview,
  previewFallback,
  parameterTag,
  previewWidth,
}: {
  desc?: ReactNode;
  hint: string;
  label: string;
  parameterTag?: string;
  preview?: ReactNode;
  previewFallback: string;
  previewWidth?: number;
}) => {
  const { token } = theme.useToken();
  const containerStyle = previewWidth
    ? { minWidth: previewWidth, width: previewWidth }
    : { minWidth: 240 };

  return (
    <Flexbox gap={12} style={containerStyle}>
      <Typography.Text style={{ whiteSpace: 'normal' }} type={'secondary'}>
        {hint}
      </Typography.Text>
      <Flexbox gap={12}>
        <Flexbox
          gap={8}
          style={{
            background: token.colorBgElevated,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 10,
            padding: 12,
            width: previewWidth,
          }}
        >
          <Flexbox horizontal align={'center'} gap={8}>
            <Typography.Text strong>{label}</Typography.Text>
            {parameterTag ? <Tag color={'cyan'}>{parameterTag}</Tag> : null}
          </Flexbox>
          {desc ? (
            <Typography.Text style={{ fontSize: 12, whiteSpace: 'normal' }} type={'secondary'}>
              {desc}
            </Typography.Text>
          ) : null}
          {preview ? (
            <div style={{ pointerEvents: 'none', width: '100%' }}>{preview}</div>
          ) : (
            <Typography.Text type={'secondary'}>{previewFallback}</Typography.Text>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

const ExtendParamsSelect = memo<ExtendParamsSelectProps>(({ value, onChange }) => {
  const { t } = useTranslation('modelProvider');
  const { t: tChat } = useTranslation('chat');

  // Preview controls use controlled mode with default values (no store access)
  const previewControls = useMemo<Partial<Record<ExtendParamsType, ReactNode>>>(
    () => ({
      disableContextCaching: <Switch checked disabled />,
      effort: <EffortSlider value="high" />,
      enableAdaptiveThinking: <Switch checked disabled />,
      enableReasoning: <Switch checked disabled />,
      gpt5ReasoningEffort: <GPT5ReasoningEffortSlider value="medium" />,
      gpt5_1ReasoningEffort: <GPT51ReasoningEffortSlider value="none" />,
      gpt5_2ProReasoningEffort: <GPT52ProReasoningEffortSlider value="medium" />,
      gpt5_2ReasoningEffort: <GPT52ReasoningEffortSlider value="none" />,
      imageAspectRatio: <ImageAspectRatioSelect value="1:1" />,
      imageAspectRatio2: <ImageAspectRatio2Select value="1:1" />,
      imageResolution: <ImageResolutionSlider value="1K" />,
      imageResolution2: <ImageResolution2Slider value="1K" />,
      reasoningBudgetToken: <ReasoningTokenSlider defaultValue={1 * 1024} />,
      reasoningEffort: <ReasoningEffortSlider value="medium" />,
      textVerbosity: <TextVerbositySlider value="medium" />,
      thinking: <ThinkingSlider value="auto" />,
      thinkingBudget: <ThinkingBudgetSlider defaultValue={2 * 1024} />,
      thinkingLevel: <ThinkingLevelSlider value="high" />,
      thinkingLevel2: <ThinkingLevel2Slider value="high" />,
      thinkingLevel3: <ThinkingLevel3Slider value="high" />,
      thinkingLevel4: <ThinkingLevel4Slider value="minimal" />,
      urlContext: <Switch checked disabled />,
    }),
    [],
  );

  const previewFallback = String(
    t('providerModels.item.modelConfig.extendParams.previewFallback', {
      defaultValue: 'Preview unavailable',
    }),
  );

  const definitions = useMemo<ExtendParamsDefinition[]>(() => {
    const descOverrides: Partial<Record<ExtendParamsType, ReactNode>> = {
      disableContextCaching: (() => {
        const original = tChat('extendParams.disableContextCaching.desc', { defaultValue: '' });

        const sanitized = original.replace(/（<\d>.*?<\/\d>）/u, '');

        return (
          sanitized || (
            <Trans i18nKey={'extendParams.disableContextCaching.desc'} ns={'chat'}>
              单条对话生成成本最高可降低 90%，响应速度提升 4 倍。开启后将自动禁用历史消息数限制
            </Trans>
          )
        );
      })(),
      enableReasoning: (() => {
        const original = tChat('extendParams.enableReasoning.desc', { defaultValue: '' });

        const sanitized = original.replace(/（<\d>.*?<\/\d>）/u, '');

        return (
          sanitized || (
            <Trans i18nKey={'extendParams.enableReasoning.desc'} ns={'chat'}>
              基于 Claude Thinking 机制限制，开启后将自动禁用历史消息数限制
            </Trans>
          )
        );
      })(),
    };

    return EXTEND_PARAMS_OPTIONS.map((item) => {
      const descKey = `extendParams.${item.key}.desc`;
      const rawDesc = tChat(descKey as any, { defaultValue: '' });
      const normalizedDesc =
        typeof rawDesc === 'string' && rawDesc !== '' && rawDesc !== descKey ? rawDesc : undefined;
      const desc = descOverrides[item.key] ?? normalizedDesc;
      const meta = PREVIEW_META[item.key];
      // Use alias key for title if available (synced with ControlsForm.tsx)
      const titleKey = TITLE_KEY_ALIASES[item.key] ?? item.key;
      const baseLabel = String(
        tChat(`extendParams.${titleKey}.title` as any, { defaultValue: item.key }),
      );

      const label =
        meta?.labelOverride ||
        (meta?.labelSuffix && `${baseLabel}${meta.labelSuffix}`) ||
        baseLabel;

      return {
        desc,
        hint: String(t(item.hintKey as any)),
        key: item.key,
        label,
        parameterTag: meta?.tag,
        preview: previewControls[item.key],
        previewWidth: meta?.previewWidth,
      };
    });
  }, [previewControls, t, tChat]);

  const definitionMap = useMemo(() => {
    return new Map(definitions.map((item) => [item.key, item]));
  }, [definitions]);

  const options = useMemo(
    () =>
      definitions.map((item) => ({
        label: item.label,
        value: item.key,
      })),
    [definitions],
  );

  const placeholder = String(t('providerModels.item.modelConfig.extendParams.placeholder'));
  const handleChange = (val: ExtendParamsType[]) => {
    if (!Array.isArray(val) || val.length === 0) {
      onChange?.(undefined);
      return;
    }

    const filtered = val.filter((item) => definitionMap.has(item));
    onChange?.(filtered.length ? filtered : undefined);
  };

  return (
    <Flexbox gap={8}>
      <Select
        allowClear
        mode={'multiple'}
        options={options}
        placeholder={placeholder}
        popupMatchSelectWidth={false}
        style={{ width: '100%' }}
        value={value}
        optionRender={(option) => {
          const def = definitionMap.get(option.value as ExtendParamsType);
          if (!def) return option.label;

          return (
            <Popover
              placement={'right'}
              content={
                <PreviewContent
                  desc={def.desc}
                  hint={def.hint}
                  label={def.label}
                  parameterTag={def.parameterTag}
                  preview={def.preview}
                  previewFallback={previewFallback}
                  previewWidth={def.previewWidth}
                />
              }
            >
              <Flexbox gap={4}>
                <Typography.Text>{def.label}</Typography.Text>
                <Typography.Text style={{ fontSize: 12 }} type={'secondary'}>
                  {def.hint}
                </Typography.Text>
              </Flexbox>
            </Popover>
          );
        }}
        onChange={(val) => handleChange(val as ExtendParamsType[])}
      />
      {value && value.length > 0 && (
        <Space wrap size={[8, 8]}>
          {value.map((key) => {
            const def = definitionMap.get(key);
            if (!def) return null;
            return (
              <Popover
                key={key}
                placement={'top'}
                content={
                  <PreviewContent
                    desc={def.desc}
                    hint={def.hint}
                    label={def.label}
                    parameterTag={def.parameterTag}
                    preview={def.preview}
                    previewFallback={previewFallback}
                    previewWidth={def.previewWidth}
                  />
                }
              >
                <Tag bordered={false} color={'processing'}>
                  {def.label}
                </Tag>
              </Popover>
            );
          })}
        </Space>
      )}
    </Flexbox>
  );
});

export default ExtendParamsSelect;
