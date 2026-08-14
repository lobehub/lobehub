import type { LobeAgentChatConfig } from '@lobechat/types';
import { type FormItemProps } from '@lobehub/ui';
import { Flexbox, Form } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { Form as AntdForm } from 'antd';
import isEqual from 'fast-deep-equal';
import { MODEL_REASONING_EXTEND_PARAMS } from 'model-bank';
import type { ReactNode } from 'react';
import { memo, useEffect, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import InfoTooltip from '@/components/InfoTooltip';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useUpdateAgentConfig } from '@/features/ChatInput/hooks/useUpdateAgentConfig';
import {
  resolveDefaultEnableAdaptiveThinkingForModel,
  resolveDefaultThinkingLevelForModel,
} from '@/services/chat/mecha/modelParamsResolver';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import CodexMaxReasoningEffortSlider from './CodexMaxReasoningEffortSlider';
import ContextCachingSwitch from './ContextCachingSwitch';
import DeepSeekReasoningEffortSlider, {
  DeepSeekV4GAReasoningEffortSlider,
} from './DeepSeekReasoningEffortSlider';
import EffortSlider from './EffortSlider';
import GLM52ReasoningEffortSlider from './GLM52ReasoningEffortSlider';
import GLM53ReasoningEffortSlider from './GLM53ReasoningEffortSlider';
import GPT5ReasoningEffortSlider from './GPT5ReasoningEffortSlider';
import GPT51ReasoningEffortSlider from './GPT51ReasoningEffortSlider';
import GPT52ProReasoningEffortSlider from './GPT52ProReasoningEffortSlider';
import GPT52ReasoningEffortSlider from './GPT52ReasoningEffortSlider';
import { GPT56ReasoningEffortSlider } from './GPT56ReasoningEffortSlider';
import Grok43ReasoningEffortSlider from './Grok43ReasoningEffortSlider';
import Grok45ReasoningEffortSlider from './Grok45ReasoningEffortSlider';
import Grok46ReasoningEffortSlider from './Grok46ReasoningEffortSlider';
import Grok420ReasoningEffortSlider from './Grok420ReasoningEffortSlider';
import Hy3ReasoningEffortSlider from './Hy3ReasoningEffortSlider';
import ImageAspectRatio2Select from './ImageAspectRatio2Select';
import ImageAspectRatioSelect from './ImageAspectRatioSelect';
import ImageResolution2Slider from './ImageResolution2Slider';
import ImageResolutionSlider from './ImageResolutionSlider';
import { KimiK3ReasoningEffortSlider } from './KimiK3ReasoningEffortSlider';
import Opus47EffortSlider from './Opus47EffortSlider';
import ReasoningEffortSlider from './ReasoningEffortSlider';
import ReasoningModeSegmented from './ReasoningModeSegmented';
import ReasoningTokenSlider from './ReasoningTokenSlider';
import ReasoningTokenSlider32k from './ReasoningTokenSlider32k';
import ReasoningTokenSlider80k from './ReasoningTokenSlider80k';
import Ring26ReasoningEffortSlider from './Ring26ReasoningEffortSlider';
import Step3_5ReasoningEffortSlider from './Step3_5ReasoningEffortSlider';
import TextVerbositySlider from './TextVerbositySlider';
import ThinkingBudgetSlider from './ThinkingBudgetSlider';
import ThinkingLevel2Slider from './ThinkingLevel2Slider';
import ThinkingLevel3Slider from './ThinkingLevel3Slider';
import ThinkingLevel4Slider from './ThinkingLevel4Slider';
import ThinkingLevelSlider from './ThinkingLevelSlider';
import ThinkingSlider from './ThinkingSlider';

const REASONING_PARAMS_SET = new Set<string>(MODEL_REASONING_EXTEND_PARAMS);

interface ControlsFormProps {
  /**
   * Override the config source. Defaults to the agent's own chatConfig; the
   * sub-agent params panel passes the sub-agent's effective (merged) config.
   */
  chatConfig?: LobeAgentChatConfig;
  disabled?: boolean;
  /**
   * Hide the reasoning-effort family + reasoningMode controls. The main-agent
   * params panel sets this: those fields migrated to user-level model-instance
   * settings edited via the ChatInput Effort control, so agent chatConfig
   * writes here would be ignored at send time. The sub-agent panel keeps them
   * as explicit per-sub-agent overrides.
   */
  hideReasoningParams?: boolean;
  model?: string;
  /**
   * Override the write sink. Defaults to updating the agent's chatConfig; the
   * sub-agent params panel redirects writes into `agencyConfig.subagent.chatConfig`.
   */
  onChatConfigChange?: (patch: Partial<LobeAgentChatConfig>) => Promise<void>;
  onUpdatingChange?: (updating: boolean) => void;
  provider?: string;
}

/**
 * Keeps the switch state aligned with runtime behavior for legacy configs.
 * Users may still have only `thinking: 'disabled'`; treating that as unset would
 * show the model default and could persist the opposite value on unrelated edits.
 */
const resolveEnableReasoningInitialValue = (config: LobeAgentChatConfig) => {
  if (Object.hasOwn(config, 'enableReasoning')) return config.enableReasoning;

  if (config.thinking === 'enabled') return true;
  if (config.thinking === 'disabled') return false;

  return undefined;
};

const resolveEnableAdaptiveThinkingInitialValue = (config: LobeAgentChatConfig, model?: string) => {
  if (Object.hasOwn(config, 'enableAdaptiveThinking')) return config.enableAdaptiveThinking;

  return resolveDefaultEnableAdaptiveThinkingForModel(model);
};

const ControlsForm = memo<ControlsFormProps>(
  ({
    chatConfig: chatConfigProp,
    disabled,
    hideReasoningParams,
    model: modelProp,
    onChatConfigChange,
    onUpdatingChange,
    provider: providerProp,
  }) => {
    const { t } = useTranslation('chat');
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const [agentModel, agentProvider] = useAgentStore((s) => [
      agentByIdSelectors.getAgentModelById(agentId)(s),
      agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    ]);
    const model = modelProp ?? agentModel;
    const provider = providerProp ?? agentProvider;
    const [form] = Form.useForm();

    const storeConfig = useAgentStore(
      (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s),
      isEqual,
    );
    const config = chatConfigProp ?? storeConfig;

    const modelExtendParams = useAiInfraStore(aiModelSelectors.modelExtendParams(model, provider));
    const initialValues = useMemo(() => {
      const enableReasoningInitialValue = resolveEnableReasoningInitialValue(config);
      const enableAdaptiveThinkingInitialValue = resolveEnableAdaptiveThinkingInitialValue(
        config,
        model,
      );

      return {
        ...config,
        enableAdaptiveThinking: enableAdaptiveThinkingInitialValue,
        enableReasoning: enableReasoningInitialValue,
      };
    }, [config, model]);

    useEffect(() => {
      form.setFieldsValue(initialValues);
    }, [form, initialValues]);

    const enableReasoningValue =
      AntdForm.useWatch(['enableReasoning'], form) ?? initialValues.enableReasoning;

    const gpt52ReasoningEffortDefaultValue = model === 'gpt-5.5' ? 'medium' : 'none';
    const thinkingLevelDefaultValue = resolveDefaultThinkingLevelForModel(model);
    const thinkingLevel3DefaultValue = resolveDefaultThinkingLevelForModel(model, 'thinkingLevel3');

    // Show descriptions as a question-mark tooltip beside the label, matching
    // the ControlRow items rendered above this form in the params panel.
    const labelWithTooltip = (label: string, tooltip: ReactNode) => (
      <Flexbox horizontal align={'center'} gap={6}>
        {label}
        <InfoTooltip title={tooltip} />
      </Flexbox>
    );

    const items = [
      {
        children: <ContextCachingSwitch disabled={disabled} />,
        label: labelWithTooltip(
          t('extendParams.disableContextCaching.title'),
          <Trans i18nKey={'extendParams.disableContextCaching.desc'} ns={'chat'}>
            单条对话生成成本最高可降低 90%，响应速度提升 4 倍（
            <a
              href={'https://www.anthropic.com/news/prompt-caching?utm_source=lobechat'}
              rel="noreferrer nofollow"
              target="_blank"
            >
              了解更多
            </a>
            ）。开启后将自动禁用历史记录限制
          </Trans>,
        ),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'disableContextCaching',
      },
      {
        children: <Switch disabled={disabled} size={'small'} />,
        label: labelWithTooltip(
          t('extendParams.enableReasoning.title'),
          <Trans i18nKey={'extendParams.enableReasoning.desc'} ns={'chat'}>
            开启后模型会先进行推理，适合复杂问题。
          </Trans>,
        ),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableReasoning',
      },
      {
        children: <Switch disabled={disabled} size={'small'} />,
        label: labelWithTooltip(
          t('extendParams.preserveThinking.title'),
          t('extendParams.preserveThinking.desc'),
        ),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'preserveThinking',
      },
      {
        children: <Switch size={'small'} />,
        label: labelWithTooltip(
          t('extendParams.enableAdaptiveThinking.title'),
          t('extendParams.enableAdaptiveThinking.desc'),
        ),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableAdaptiveThinking',
      },
      (enableReasoningValue || modelExtendParams?.includes('reasoningBudgetToken')) && {
        children: <ReasoningTokenSlider />,
        label: t('extendParams.reasoningBudgetToken.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'reasoningBudgetToken',
        style: {
          paddingBottom: 0,
        },
      },
      modelExtendParams?.includes('reasoningBudgetToken32k') && {
        children: <ReasoningTokenSlider32k />,
        label: t('extendParams.reasoningBudgetToken.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'reasoningBudgetToken32k',
        style: {
          paddingBottom: 0,
        },
      },
      modelExtendParams?.includes('reasoningBudgetToken80k') && {
        children: <ReasoningTokenSlider80k />,
        label: t('extendParams.reasoningBudgetToken.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'reasoningBudgetToken80k',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <DeepSeekV4GAReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'deepseekV4GAReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <DeepSeekReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'deepseekV4ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'reasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <ReasoningModeSegmented />,
        label: labelWithTooltip(
          t('extendParams.reasoningMode.title'),
          t('extendParams.reasoningMode.desc'),
        ),
        layout: 'vertical',
        minWidth: undefined,
        name: 'reasoningMode',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <EffortSlider />,
        label: labelWithTooltip(t('extendParams.effort.title'), t('extendParams.effort.desc')),
        layout: 'vertical',
        minWidth: undefined,
        name: 'effort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <Opus47EffortSlider />,
        label: labelWithTooltip(t('extendParams.effort.title'), t('extendParams.effort.desc')),
        layout: 'vertical',
        minWidth: undefined,
        name: 'opus47Effort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <GPT5ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'gpt5ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <GPT51ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'gpt5_1ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <GPT52ReasoningEffortSlider defaultValue={gpt52ReasoningEffortDefaultValue} />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'gpt5_2ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <GPT56ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'gpt5_6ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <GPT52ProReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'gpt5_2ProReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <GLM52ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'glm5_2ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <GLM53ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'glm5_3ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <Grok420ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'grok4_20ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <Grok43ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'grok4_3ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <Grok45ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'grok4_5ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <Grok46ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'grok4_6ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <Hy3ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'hy3ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <KimiK3ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'kimiK3ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <Ring26ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'ring2_6ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <CodexMaxReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'codexMaxReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <Step3_5ReasoningEffortSlider />,
        label: t('extendParams.reasoningEffort.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'step3_5ReasoningEffort',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <TextVerbositySlider />,
        label: t('extendParams.textVerbosity.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'textVerbosity',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <ThinkingBudgetSlider />,
        label: t('extendParams.thinkingBudget.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'thinkingBudget',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <Switch disabled={disabled} size={'small'} />,
        label: labelWithTooltip(
          t('extendParams.urlContext.title'),
          t('extendParams.urlContext.desc'),
        ),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'urlContext',
        style: undefined,
      },
      {
        children: <ThinkingSlider />,
        label: t('extendParams.thinking.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'thinking',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <ThinkingLevelSlider defaultValue={thinkingLevelDefaultValue} />,
        label: t('extendParams.thinkingLevel.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'thinkingLevel',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <ThinkingLevel2Slider />,
        label: t('extendParams.thinkingLevel.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'thinkingLevel2',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <ThinkingLevel3Slider defaultValue={thinkingLevel3DefaultValue} />,
        label: t('extendParams.thinkingLevel.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'thinkingLevel3',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <ThinkingLevel4Slider />,
        label: t('extendParams.thinkingLevel.title'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'thinkingLevel4',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <ImageAspectRatioSelect />,
        label: t('extendParams.imageAspectRatio.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'imageAspectRatio',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <ImageAspectRatio2Select />,
        label: t('extendParams.imageAspectRatio.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'imageAspectRatio2',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <ImageResolutionSlider />,
        label: t('extendParams.imageResolution.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'imageResolution',
        style: {
          paddingBottom: 0,
        },
      },
      {
        children: <ImageResolution2Slider />,
        label: t('extendParams.imageResolution.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'imageResolution2',
        style: {
          paddingBottom: 0,
        },
      },
    ].filter(Boolean) as FormItemProps[];

    return (
      <div
        style={{
          opacity: disabled ? 0.5 : undefined,
          pointerEvents: disabled ? 'none' : undefined,
        }}
      >
        <Form
          form={form}
          initialValues={initialValues}
          itemsType={'flat'}
          size={'small'}
          style={{ fontSize: 12 }}
          variant={'borderless'}
          items={
            (modelExtendParams || [])
              .filter((item: any) => !(hideReasoningParams && REASONING_PARAMS_SET.has(item)))
              .map((item: any) => items.find((i) => i.name === item))
              .filter(Boolean) as FormItemProps[]
          }
          onValuesChange={async (values) => {
            if (disabled) return;
            onUpdatingChange?.(true);
            try {
              await (onChatConfigChange ?? updateAgentChatConfig)(values);
            } finally {
              onUpdatingChange?.(false);
            }
          }}
        />
      </div>
    );
  },
);

export default ControlsForm;
