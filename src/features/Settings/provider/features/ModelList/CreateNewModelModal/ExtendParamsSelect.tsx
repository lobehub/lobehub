import { cssVar, Flexbox, Popover, Select, Switch, Tag, Text } from '@lobehub/ui';
import { type ExtendParamsType } from 'model-bank';
import { memo, type ReactNode, type SyntheticEvent, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import ImageAspectRatio2Select from '@/features/ModelSwitchPanel/components/ControlsForm/ImageAspectRatio2Select';
import ImageAspectRatioSelect from '@/features/ModelSwitchPanel/components/ControlsForm/ImageAspectRatioSelect';
import ImageResolution2Slider from '@/features/ModelSwitchPanel/components/ControlsForm/ImageResolution2Slider';
import ImageResolutionSlider from '@/features/ModelSwitchPanel/components/ControlsForm/ImageResolutionSlider';
import ReasoningModeSegmented from '@/features/ModelSwitchPanel/components/ControlsForm/ReasoningModeSegmented';
import ReasoningTokenSlider from '@/features/ModelSwitchPanel/components/ControlsForm/ReasoningTokenSlider';
import ReasoningTokenSlider32k from '@/features/ModelSwitchPanel/components/ControlsForm/ReasoningTokenSlider32k';
import ReasoningTokenSlider80k from '@/features/ModelSwitchPanel/components/ControlsForm/ReasoningTokenSlider80k';
import TextVerbositySlider from '@/features/ModelSwitchPanel/components/ControlsForm/TextVerbositySlider';
import ThinkingBudgetSlider from '@/features/ModelSwitchPanel/components/ControlsForm/ThinkingBudgetSlider';
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
    hintKey: 'providerModels.item.modelConfig.extendParams.options.preserveThinking.hint',
    key: 'preserveThinking',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.reasoningBudgetToken.hint',
    key: 'reasoningBudgetToken',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.reasoningBudgetToken32k.hint',
    key: 'reasoningBudgetToken32k',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.reasoningBudgetToken80k.hint',
    key: 'reasoningBudgetToken80k',
  },
  {
    hintKey: 'providerModels.item.modelConfig.extendParams.options.reasoningMode.hint',
    key: 'reasoningMode',
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
  imageAspectRatio2: 'imageAspectRatio',
  imageResolution2: 'imageResolution',
  reasoningBudgetToken32k: 'reasoningBudgetToken',
  reasoningBudgetToken80k: 'reasoningBudgetToken',
};

type PreviewMeta = {
  labelOverride?: string;
  labelSuffix?: string;
  previewWidth?: number;
  tag?: string;
};

const PREVIEW_META: Partial<Record<ExtendParamsType, PreviewMeta>> = {
  disableContextCaching: { labelSuffix: ' (Claude)', previewWidth: 400 },
  enableAdaptiveThinking: {
    labelSuffix: ' (Opus 4.6)',
    previewWidth: 300,
    tag: 'thinking.type',
  },
  enableReasoning: { previewWidth: 300, tag: 'thinking.type' },
  imageAspectRatio: { labelSuffix: '', previewWidth: 350, tag: 'aspect_ratio' },
  imageAspectRatio2: { labelSuffix: ' (Nano Banana 2)', previewWidth: 350, tag: 'aspect_ratio' },
  imageResolution: { labelSuffix: '', previewWidth: 250, tag: 'resolution' },
  imageResolution2: { labelSuffix: ' (512px+)', previewWidth: 280, tag: 'resolution' },
  preserveThinking: {
    labelSuffix: ' (Qwen3.6+ / GLM-4.7+)',
    previewWidth: 460,
    tag: 'preserve_thinking',
  },
  reasoningMode: { labelSuffix: ' (GPT-5.6)', previewWidth: 280, tag: 'reasoning.mode' },
  reasoningBudgetToken: { previewWidth: 350, tag: 'thinking.budget_tokens' },
  reasoningBudgetToken32k: {
    labelSuffix: ' (32k)',
    previewWidth: 350,
    tag: 'thinking.budget_tokens',
  },
  reasoningBudgetToken80k: {
    labelSuffix: ' (80k)',
    previewWidth: 350,
    tag: 'thinking.budget_tokens',
  },
  textVerbosity: { labelSuffix: '', previewWidth: 250, tag: 'text_verbosity' },
  thinking: { labelSuffix: ' (Doubao)', previewWidth: 300, tag: 'thinking.type' },
  thinkingBudget: { labelSuffix: ' (Gemini)', previewWidth: 500, tag: 'thinkingBudget' },
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
  onChange?: (value: ExtendParamsType[]) => void;
  value?: ExtendParamsType[];
}

export const normalizeExtendParamsValue = (
  value: ExtendParamsType[] | undefined,
  definitionMap: Map<ExtendParamsType, ExtendParamsDefinition>,
): ExtendParamsType[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  return value.filter((item) => definitionMap.has(item));
};

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
  const containerStyle = previewWidth
    ? { minWidth: previewWidth, width: previewWidth }
    : { minWidth: 240 };

  const stop = (e: SyntheticEvent) => e.stopPropagation();

  return (
    <div
      onClick={stop}
      onClickCapture={stop}
      onKeyDown={stop}
      onMouseDown={stop}
      onMouseDownCapture={stop}
      onMouseUp={stop}
      onMouseUpCapture={stop}
      onPointerDown={stop}
      onPointerDownCapture={stop}
      onPointerUp={stop}
      onPointerUpCapture={stop}
    >
      <Flexbox gap={12} style={containerStyle}>
        <Text type={'secondary'} whiteSpace={'normal'}>
          {hint}
        </Text>
        <Flexbox gap={12}>
          <Flexbox
            gap={8}
            style={{
              background: cssVar.colorBgElevated,
              border: `1px solid ${cssVar.colorBorderSecondary}`,
              borderRadius: 10,
              padding: 12,
              width: previewWidth,
            }}
          >
            <Flexbox horizontal align={'center'} gap={8}>
              <Text strong>{label}</Text>
              {parameterTag ? <Tag color={'cyan'}>{parameterTag}</Tag> : null}
            </Flexbox>
            {desc ? (
              <Text fontSize={12} type={'secondary'} whiteSpace={'normal'}>
                {desc}
              </Text>
            ) : null}
            {preview ? (
              <div aria-hidden style={{ opacity: 0.72, pointerEvents: 'none', width: '100%' }}>
                {preview}
              </div>
            ) : (
              <Text type={'secondary'}>{previewFallback}</Text>
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </div>
  );
};

const ExtendParamsSelect = memo<ExtendParamsSelectProps>(({ value, onChange }) => {
  const { t } = useTranslation('modelProvider');
  const { t: tChat } = useTranslation('chat');

  // Preview controls are read-only examples; the form only stores supported parameter keys.
  const previewControls = useMemo<Partial<Record<ExtendParamsType, ReactNode>>>(
    () => ({
      disableContextCaching: <Switch checked disabled />,
      enableAdaptiveThinking: <Switch checked disabled />,
      enableReasoning: <Switch checked disabled />,
      preserveThinking: <Switch checked disabled />,
      imageAspectRatio: <ImageAspectRatioSelect value="1:1" />,
      imageAspectRatio2: <ImageAspectRatio2Select value="1:1" />,
      imageResolution: <ImageResolutionSlider value="1K" />,
      imageResolution2: <ImageResolution2Slider value="1K" />,
      reasoningBudgetToken: <ReasoningTokenSlider defaultValue={1 * 1024} />,
      reasoningBudgetToken32k: <ReasoningTokenSlider32k defaultValue={1 * 1024} />,
      reasoningBudgetToken80k: <ReasoningTokenSlider80k defaultValue={1 * 1024} />,
      reasoningMode: <ReasoningModeSegmented value="standard" />,
      textVerbosity: <TextVerbositySlider value="medium" />,
      thinking: <ThinkingSlider value="auto" />,
      thinkingBudget: <ThinkingBudgetSlider defaultValue={2 * 1024} />,
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
              开启后模型会先进行推理，适合复杂问题。
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
    onChange?.(normalizeExtendParamsValue(val, definitionMap));
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
                <Text>{def.label}</Text>
                <Text fontSize={12} type={'secondary'}>
                  {def.hint}
                </Text>
              </Flexbox>
            </Popover>
          );
        }}
        onChange={(val) => handleChange(val as ExtendParamsType[])}
      />
      {value && value.length > 0 && (
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
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
                <Tag color={'processing'}>{def.label}</Tag>
              </Popover>
            );
          })}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default ExtendParamsSelect;
