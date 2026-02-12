import { type FormItemProps } from '@lobehub/ui';
import { Form } from '@lobehub/ui';
import { Form as AntdForm, Grid, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import ContextCachingSwitch from './ContextCachingSwitch';
import EffortSlider from './EffortSlider';
import GPT5ReasoningEffortSlider from './GPT5ReasoningEffortSlider';
import GPT51ReasoningEffortSlider from './GPT51ReasoningEffortSlider';
import GPT52ProReasoningEffortSlider from './GPT52ProReasoningEffortSlider';
import GPT52ReasoningEffortSlider from './GPT52ReasoningEffortSlider';
import ImageAspectRatioSelect from './ImageAspectRatioSelect';
import ImageResolutionSlider from './ImageResolutionSlider';
import ReasoningEffortSlider from './ReasoningEffortSlider';
import ReasoningTokenSlider from './ReasoningTokenSlider';
import TextVerbositySlider from './TextVerbositySlider';
import ThinkingBudgetSlider from './ThinkingBudgetSlider';
import ThinkingLevel2Slider from './ThinkingLevel2Slider';
import ThinkingLevelSlider from './ThinkingLevelSlider';
import ThinkingSlider from './ThinkingSlider';

const ControlsForm = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const [model, provider] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
  ]);
  const [form] = Form.useForm();
  const enableReasoning = AntdForm.useWatch(['enableReasoning'], form);

  const config = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s),
    isEqual,
  );

  const modelExtendParams = useAiInfraStore(aiModelSelectors.modelExtendParams(model, provider));

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
            基于 Claude Thinking 机制限制（
            <a
              rel="noreferrer nofollow"
              target="_blank"
              href={
                'https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking?utm_source=lobechat#why-thinking-blocks-must-be-preserved'
              }
            >
              了解更多
            </a>
            ），开启后将自动禁用历史消息数限制
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
    (enableReasoning || modelExtendParams?.includes('reasoningBudgetToken')) && {
      children: <ReasoningTokenSlider />,
      label: t('extendParams.reasoningBudgetToken.title'),
      layout: 'vertical',
      minWidth: undefined,
      name: 'reasoningBudgetToken',
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
      minWidth: 460,
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
      style: isNarrow ? undefined : { minWidth: 360 },
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
        minWidth: 400,
        paddingBottom: 0,
      },
      tag: 'thinkingLevel',
    },
    {
      children: <ThinkingLevel2Slider />,
      label: t('extendParams.thinkingLevel.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'thinkingLevel2',
      style: {
        minWidth: 400,
        paddingBottom: 0,
      },
      tag: 'thinkingLevel',
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
      tag: 'aspectRatio',
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
      tag: 'imageSize',
    },
  ].filter(Boolean) as FormItemProps[];

  return (
    <Form
      form={form}
      initialValues={config}
      itemsType={'flat'}
      size={'small'}
      style={{ fontSize: 12 }}
      variant={'borderless'}
      items={
        (modelExtendParams || [])
          .map((item: any) => items.find((i) => i.name === item))
          .filter(Boolean) as FormItemProps[]
      }
      onValuesChange={async (_, values) => {
        await updateAgentChatConfig(values);
      }}
    />
  );
});

export default ControlsForm;
