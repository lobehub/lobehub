import type { LobeAgentChatConfig } from '@lobechat/types';
import { type FormItemProps } from '@lobehub/ui';
import { Form } from '@lobehub/ui';
import { Form as AntdForm, Grid, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useEffect, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useUpdateAgentConfig } from '@/features/ChatInput/hooks/useUpdateAgentConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import CodexMaxReasoningEffortSlider from './CodexMaxReasoningEffortSlider';
import ContextCachingSwitch from './ContextCachingSwitch';
import DeepseekV4ReasoningEffortSlider from './DeepseekV4ReasoningEffortSlider';
import EffortSlider from './EffortSlider';
import GPT5ReasoningEffortSlider from './GPT5ReasoningEffortSlider';
import GPT51ReasoningEffortSlider from './GPT51ReasoningEffortSlider';
import GPT52ProReasoningEffortSlider from './GPT52ProReasoningEffortSlider';
import GPT52ReasoningEffortSlider from './GPT52ReasoningEffortSlider';
import Grok420ReasoningEffortSlider from './Grok420ReasoningEffortSlider';
import ImageAspectRatio2Select from './ImageAspectRatio2Select';
import ImageAspectRatioSelect from './ImageAspectRatioSelect';
import ImageResolution2Slider from './ImageResolution2Slider';
import ImageResolutionSlider from './ImageResolutionSlider';
import Opus47EffortSlider from './Opus47EffortSlider';
import ReasoningEffortSlider from './ReasoningEffortSlider';
import ReasoningTokenSlider from './ReasoningTokenSlider';
import ReasoningTokenSlider32k from './ReasoningTokenSlider32k';
import ReasoningTokenSlider80k from './ReasoningTokenSlider80k';
import TextVerbositySlider from './TextVerbositySlider';
import ThinkingBudgetSlider from './ThinkingBudgetSlider';
import ThinkingLevel2Slider from './ThinkingLevel2Slider';
import ThinkingLevel3Slider from './ThinkingLevel3Slider';
import ThinkingLevel4Slider from './ThinkingLevel4Slider';
import ThinkingLevel5Slider from './ThinkingLevel5Slider';
import ThinkingLevelSlider from './ThinkingLevelSlider';
import ThinkingSlider from './ThinkingSlider';

interface ControlsFormProps {
  model?: string;
  provider?: string;
}

/**
 * Keeps the switch state aligned with runtime behavior for legacy configs.
 * Users may still have only `thinking: 'disabled'`; treating that as unset would
 * show the model default and could persist the opposite value on unrelated edits.
 */
const resolveEnableReasoningInitialValue = (
  config: LobeAgentChatConfig,
  defaultValue?: boolean,
) => {
  if (Object.hasOwn(config, 'enableReasoning')) return config.enableReasoning;

  if (config.thinking === 'enabled') return true;
  if (config.thinking === 'disabled') return false;

  return defaultValue;
};

const ControlsForm = memo<ControlsFormProps>(({ model: modelProp, provider: providerProp }) => {
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

  const config = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s),
    isEqual,
  );

  const modelExtendParams = useAiInfraStore(aiModelSelectors.modelExtendParams(model, provider));
  const modelExtendParamOptions = useAiInfraStore(
    aiModelSelectors.modelExtendParamOptions(model, provider),
  );
  const initialValues = useMemo(() => {
    const enableReasoningInitialValue = resolveEnableReasoningInitialValue(
      config,
      modelExtendParamOptions?.enableReasoning?.defaultValue,
    );

    return {
      ...config,
      enableReasoning: enableReasoningInitialValue,
    };
  }, [config, modelExtendParamOptions?.enableReasoning?.defaultValue]);

  useEffect(() => {
    form.setFieldsValue(initialValues);
  }, [form, initialValues]);

  const enableReasoning =
    AntdForm.useWatch(['enableReasoning'], form) ?? initialValues.enableReasoning;
  const includeReasoningBudget = modelExtendParamOptions?.enableReasoning?.includeBudget !== false;

  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.sm;

  const descWide = { display: 'inline-block', width: 300 } as const;
  const descNarrow = {
    display: 'block',
    maxWidth: '100%',
    whiteSpace: 'normal',
  } as const;

  const items = [
    {
      children: <ContextCachingSwitch />,
      desc: (
        <span style={isNarrow ? descNarrow : descWide}>
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
          </Trans>
        </span>
      ),
      label: t('extendParams.disableContextCaching.title'),
      layout: isNarrow ? 'vertical' : 'horizontal',
      minWidth: undefined,
      name: 'disableContextCaching',
    },
    {
      children: <Switch />,
      desc: (
        <span style={isNarrow ? descNarrow : descWide}>
          <Trans i18nKey={'extendParams.enableReasoning.desc'} ns={'chat'}>
            开启后模型会先进行推理，适合复杂问题。
          </Trans>
        </span>
      ),
      label: t('extendParams.enableReasoning.title'),
      layout: isNarrow ? 'vertical' : 'horizontal',
      minWidth: undefined,
      name: 'enableReasoning',
    },
    {
      children: <Switch />,
      desc: isNarrow ? (
        <span style={descNarrow}>{t('extendParams.enableAdaptiveThinking.desc')}</span>
      ) : (
        t('extendParams.enableAdaptiveThinking.desc')
      ),
      label: t('extendParams.enableAdaptiveThinking.title'),
      layout: isNarrow ? 'vertical' : 'horizontal',
      minWidth: undefined,
      name: 'enableAdaptiveThinking',
    },
    ((enableReasoning && includeReasoningBudget) ||
      modelExtendParams?.includes('reasoningBudgetToken')) && {
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
      children: <ReasoningEffortSlider />,
      desc: 'reasoning_effort',
      label: t('extendParams.reasoningEffort.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'reasoningEffort',
      style: {
        paddingBottom: 0,
      },
    },
    {
      children: <EffortSlider />,
      desc: isNarrow ? (
        <span style={descNarrow}>{t('extendParams.effort.desc')}</span>
      ) : (
        t('extendParams.effort.desc')
      ),
      label: t('extendParams.effort.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'effort',
      style: {
        paddingBottom: 0,
      },
    },
    {
      children: <Opus47EffortSlider />,
      desc: isNarrow ? (
        <span style={descNarrow}>{t('extendParams.effort.desc')}</span>
      ) : (
        t('extendParams.effort.desc')
      ),
      label: t('extendParams.effort.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'opus47Effort',
      style: {
        paddingBottom: 0,
      },
    },
    {
      children: <GPT5ReasoningEffortSlider />,
      desc: 'reasoning_effort',
      label: t('extendParams.reasoningEffort.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'gpt5ReasoningEffort',
      style: {
        paddingBottom: 0,
      },
    },
    {
      children: <GPT51ReasoningEffortSlider />,
      desc: 'reasoning_effort',
      label: t('extendParams.reasoningEffort.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'gpt5_1ReasoningEffort',
      style: {
        paddingBottom: 0,
      },
    },
    {
      children: <GPT52ReasoningEffortSlider />,
      desc: 'reasoning_effort',
      label: t('extendParams.reasoningEffort.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'gpt5_2ReasoningEffort',
      style: {
        paddingBottom: 0,
      },
    },
    {
      children: <GPT52ProReasoningEffortSlider />,
      desc: 'reasoning_effort',
      label: t('extendParams.reasoningEffort.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'gpt5_2ProReasoningEffort',
      style: {
        paddingBottom: 0,
      },
    },
    {
      children: <Grok420ReasoningEffortSlider />,
      desc: 'reasoning_effort',
      label: t('extendParams.reasoningEffort.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'grok4_20ReasoningEffort',
      style: {
        paddingBottom: 0,
      },
    },
    {
      children: <DeepseekV4ReasoningEffortSlider />,
      desc: 'reasoning_effort',
      label: t('extendParams.reasoningEffort.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'deepseekV4ReasoningEffort',
      style: {
        paddingBottom: 0,
      },
    },
    {
      children: <CodexMaxReasoningEffortSlider />,
      desc: 'reasoning_effort',
      label: t('extendParams.reasoningEffort.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'codexMaxReasoningEffort',
      style: {
        paddingBottom: 0,
      },
    },
    {
      children: <TextVerbositySlider />,
      desc: 'text_verbosity',
      label: t('extendParams.textVerbosity.title'),
      layout: 'horizontal',
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
      tag: 'thinkingBudget',
    },
    {
      children: <Switch />,
      desc: isNarrow ? (
        <span style={descNarrow}>{t('extendParams.urlContext.desc')}</span>
      ) : (
        t('extendParams.urlContext.desc')
      ),
      label: t('extendParams.urlContext.title'),
      layout: isNarrow ? 'vertical' : 'horizontal',
      minWidth: undefined,
      name: 'urlContext',
      style: undefined,
      tag: 'urlContext',
    },
    {
      children: <ThinkingSlider />,
      label: t('extendParams.thinking.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'thinking',
      style: {
        paddingBottom: 0,
      },
    },
    {
      children: <ThinkingLevelSlider />,
      label: t('extendParams.thinkingLevel.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'thinkingLevel',
      style: {
        paddingBottom: 0,
      },
      desc: 'thinkingLevel',
    },
    {
      children: <ThinkingLevel2Slider />,
      label: t('extendParams.thinkingLevel.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'thinkingLevel2',
      style: {
        paddingBottom: 0,
      },
      desc: 'thinkingLevel',
    },
    {
      children: <ThinkingLevel3Slider />,
      label: t('extendParams.thinkingLevel.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'thinkingLevel3',
      style: {
        paddingBottom: 0,
      },
      desc: 'thinkingLevel',
    },
    {
      children: <ThinkingLevel4Slider />,
      label: t('extendParams.thinkingLevel.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'thinkingLevel4',
      style: {
        paddingBottom: 0,
      },
      desc: 'thinkingLevel',
    },
    {
      children: <ThinkingLevel5Slider />,
      label: t('extendParams.thinkingLevel.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'thinkingLevel5',
      style: {
        paddingBottom: 0,
      },
      desc: 'thinkingLevel',
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
      desc: 'aspectRatio',
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
      desc: 'aspectRatio',
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
      desc: 'imageSize',
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
      desc: 'imageSize',
    },
  ].filter(Boolean) as FormItemProps[];

  return (
    <Form
      form={form}
      initialValues={initialValues}
      itemsType={'flat'}
      size={'small'}
      style={{ fontSize: 12 }}
      variant={'borderless'}
      items={
        (modelExtendParams || [])
          .map((item: any) => items.find((i) => i.name === item))
          .filter(Boolean) as FormItemProps[]
      }
      onValuesChange={async (values) => {
        await updateAgentChatConfig(values);
      }}
    />
  );
});

export default ControlsForm;
