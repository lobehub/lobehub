import type { LobeAgentChatConfig } from '@lobechat/types';
import { Flexbox, Switch } from '@lobehub/ui';
import { Form, type FormFieldProps, useForm, useWatch } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import type { ReactNode } from 'react';
import { memo, useEffect, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import InfoTooltip from '@/components/InfoTooltip';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useUpdateAgentConfig } from '@/features/ChatInput/hooks/useUpdateAgentConfig';
import { resolveDefaultEnableAdaptiveThinkingForModel } from '@/services/chat/mecha/modelParamsResolver';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import ContextCachingSwitch from './ContextCachingSwitch';
import ImageAspectRatio2Select from './ImageAspectRatio2Select';
import ImageAspectRatioSelect from './ImageAspectRatioSelect';
import ImageResolution2Slider from './ImageResolution2Slider';
import ImageResolutionSlider from './ImageResolutionSlider';
import ReasoningEffortSlider from './ReasoningEffortSlider';
import ReasoningModeSegmented from './ReasoningModeSegmented';
import ReasoningTokenSlider from './ReasoningTokenSlider';
import ReasoningTokenSlider32k from './ReasoningTokenSlider32k';
import ReasoningTokenSlider80k from './ReasoningTokenSlider80k';
import TextVerbositySlider from './TextVerbositySlider';
import ThinkingBudgetSlider from './ThinkingBudgetSlider';
import ThinkingSlider from './ThinkingSlider';

interface ControlsFormProps {
  /**
   * Override the config source. Defaults to the agent's own chatConfig; the
   * sub-agent params panel passes the sub-agent's effective (merged) config.
   */
  chatConfig?: LobeAgentChatConfig;
  disabled?: boolean;
  /**
   * Hide the reasoning effort + reasoningMode controls. The main-agent
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
    const storeConfig = useAgentStore(
      (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s),
      isEqual,
    );
    const config = chatConfigProp ?? storeConfig;

    const modelExtendParams = useAiInfraStore(aiModelSelectors.modelExtendParams(model, provider));
    const reasoningEffortSettings = useAiInfraStore(
      aiModelSelectors.modelReasoningEffortSettings(model, provider),
      isEqual,
    );
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

    const form = useForm<LobeAgentChatConfig>({
      initialValues,
      onValuesChange: async (values) => {
        if (disabled) return;
        onUpdatingChange?.(true);
        try {
          await (onChatConfigChange ?? updateAgentChatConfig)(
            values as Partial<LobeAgentChatConfig>,
          );
        } finally {
          onUpdatingChange?.(false);
        }
      },
    });

    useEffect(() => {
      form.setValues(initialValues);
    }, [form, initialValues]);

    const enableReasoningValue = useWatch(form, 'enableReasoning') ?? initialValues.enableReasoning;

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
    ].filter(Boolean) as FormFieldProps<LobeAgentChatConfig>[];

    const reasoningEffortItem: FormFieldProps<LobeAgentChatConfig> | undefined =
      reasoningEffortSettings && !hideReasoningParams
        ? {
            children: <ReasoningEffortSlider settings={reasoningEffortSettings} />,
            label: t('extendParams.reasoningEffort.title'),
            layout: 'vertical',
            minWidth: undefined,
            name: 'reasoningEffort',
            style: { paddingBottom: 0 },
          }
        : undefined;

    const extendParamItems = (modelExtendParams || [])
      .filter((param) => !(hideReasoningParams && param === 'reasoningMode'))
      .map((param) => items.find((item) => item.name === param))
      .filter(Boolean) as FormFieldProps<LobeAgentChatConfig>[];

    // The effort control comes from the card's `reasoningEffort`, not its
    // extend params; it sits right before the reasoning mode, else last.
    const reasoningModeIndex = extendParamItems.findIndex((item) => item.name === 'reasoningMode');
    const formItems = reasoningEffortItem
      ? reasoningModeIndex === -1
        ? [...extendParamItems, reasoningEffortItem]
        : [
            ...extendParamItems.slice(0, reasoningModeIndex),
            reasoningEffortItem,
            ...extendParamItems.slice(reasoningModeIndex),
          ]
      : extendParamItems;

    return (
      <div
        style={{
          opacity: disabled ? 0.5 : undefined,
          pointerEvents: disabled ? 'none' : undefined,
        }}
      >
        <Form
          form={form}
          items={formItems}
          itemsType={'flat'}
          style={{ fontSize: 12 }}
          variant={'borderless'}
        />
      </div>
    );
  },
);

export default ControlsForm;
