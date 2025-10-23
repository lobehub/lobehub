'use client';

import {
  Form,
  type FormGroupItemType,
  type FormItemProps,
  Select,
  SliderWithInput,
} from '@lobehub/ui';
import { Form as AntdForm, Checkbox, Switch } from 'antd';
import { createStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import InfoTooltip from '@/components/InfoTooltip';
import { FORM_STYLE } from '@/const/layoutTokens';
import ModelSelect from '@/features/ModelSelect';
import { useProviderName } from '@/hooks/useProviderName';

import { selectors, useStore } from '../store';

type ParamKey = 'temperature' | 'top_p' | 'presence_penalty' | 'frequency_penalty';

const useStyles = createStyles(({ css, token }) => ({
  checkbox: css`
    .ant-checkbox-inner {
      border-radius: 4px;
    }

    &:hover .ant-checkbox-inner {
      border-color: ${token.colorPrimary};
    }
  `,
  label: css`
    user-select: none;
  `,
  sliderWrapper: css`
    display: flex;
    gap: 16px;
    align-items: center;
    width: 100%;
  `,
}));

// Wrapper component for slider with checkbox
interface SliderWithCheckboxProps {
  checked: boolean;
  disabled: boolean;
  max: number;
  min: number;
  onChange?: (value: number) => void;
  onToggle: (checked: boolean) => void;
  step: number;
  styles: any;
  value?: number;
}

const SliderWithCheckbox = memo<SliderWithCheckboxProps>(
  ({ value, onChange, disabled, checked, onToggle, styles, min, max, step }) => {
    return (
      <div className={styles.sliderWrapper}>
        <Checkbox
          checked={checked}
          className={styles.checkbox}
          onChange={(e) => {
            e.stopPropagation();
            onToggle(e.target.checked);
          }}
        />
        <div style={{ flex: 1 }}>
          <SliderWithInput
            disabled={disabled}
            max={max}
            min={min}
            onChange={onChange}
            step={step}
            value={value}
          />
        </div>
      </div>
    );
  },
);

const PARAM_NAME_MAP: Record<ParamKey, (string | number)[]> = {
  frequency_penalty: ['params', 'frequency_penalty'],
  presence_penalty: ['params', 'presence_penalty'],
  temperature: ['params', 'temperature'],
  top_p: ['params', 'top_p'],
};

const PARAM_DEFAULTS: Record<ParamKey, number> = {
  frequency_penalty: 0,
  presence_penalty: 0,
  temperature: 0.7,
  top_p: 1,
};

const PARAM_CONFIG = {
  frequency_penalty: {
    descKey: 'settingModel.frequencyPenalty.desc',
    labelKey: 'settingModel.frequencyPenalty.title',
    slider: { max: 2, min: -2, step: 0.1 },
    tag: 'frequency_penalty',
  },
  presence_penalty: {
    descKey: 'settingModel.presencePenalty.desc',
    labelKey: 'settingModel.presencePenalty.title',
    slider: { max: 2, min: -2, step: 0.1 },
    tag: 'presence_penalty',
  },
  temperature: {
    descKey: 'settingModel.temperature.desc',
    labelKey: 'settingModel.temperature.title',
    slider: { max: 2, min: 0, step: 0.1 },
    tag: 'temperature',
  },
  top_p: {
    descKey: 'settingModel.topP.desc',
    labelKey: 'settingModel.topP.title',
    slider: { max: 1, min: 0, step: 0.1 },
    tag: 'top_p',
  },
} satisfies Record<
  ParamKey,
  {
    descKey: string;
    labelKey: string;
    slider: { max: number; min: number; step: number };
    tag: string;
  }
>;

const AgentModal = memo(() => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();
  const config = useStore(selectors.currentAgentConfig, isEqual);
  const { styles } = useStyles();

  const enableMaxTokens = AntdForm.useWatch(['chatConfig', 'enableMaxTokens'], form);
  const enableReasoningEffort = AntdForm.useWatch(['chatConfig', 'enableReasoningEffort'], form);

  const updateConfig = useStore((s) => s.setAgentConfig);
  const provider = useStore((s) => s.config.provider);
  const providerName = useProviderName(provider as string);

  const { temperature, top_p, presence_penalty, frequency_penalty } = config.params ?? {};

  const lastValuesRef = useRef<Record<ParamKey, number | undefined>>({
    frequency_penalty,
    presence_penalty,
    temperature,
    top_p,
  });

  useEffect(() => {
    form.setFieldsValue({
      ...config,
      _modalConfig: {
        model: config.model,
        provider: config.provider,
      },
    });

    if (typeof temperature === 'number') lastValuesRef.current.temperature = temperature;
    if (typeof top_p === 'number') lastValuesRef.current.top_p = top_p;
    if (typeof presence_penalty === 'number') {
      lastValuesRef.current.presence_penalty = presence_penalty;
    }
    if (typeof frequency_penalty === 'number') {
      lastValuesRef.current.frequency_penalty = frequency_penalty;
    }
  }, [config, form, temperature, top_p, presence_penalty, frequency_penalty]);

  const temperatureValue = AntdForm.useWatch(PARAM_NAME_MAP.temperature, form);
  const topPValue = AntdForm.useWatch(PARAM_NAME_MAP.top_p, form);
  const presencePenaltyValue = AntdForm.useWatch(PARAM_NAME_MAP.presence_penalty, form);
  const frequencyPenaltyValue = AntdForm.useWatch(PARAM_NAME_MAP.frequency_penalty, form);

  useEffect(() => {
    if (typeof temperatureValue === 'number') lastValuesRef.current.temperature = temperatureValue;
  }, [temperatureValue]);

  useEffect(() => {
    if (typeof topPValue === 'number') lastValuesRef.current.top_p = topPValue;
  }, [topPValue]);

  useEffect(() => {
    if (typeof presencePenaltyValue === 'number') {
      lastValuesRef.current.presence_penalty = presencePenaltyValue;
    }
  }, [presencePenaltyValue]);

  useEffect(() => {
    if (typeof frequencyPenaltyValue === 'number') {
      lastValuesRef.current.frequency_penalty = frequencyPenaltyValue;
    }
  }, [frequencyPenaltyValue]);

  const enabledMap: Record<ParamKey, boolean> = {
    frequency_penalty: typeof frequencyPenaltyValue === 'number',
    presence_penalty: typeof presencePenaltyValue === 'number',
    temperature: typeof temperatureValue === 'number',
    top_p: typeof topPValue === 'number',
  };

  const handleToggle = useCallback(
    (key: ParamKey, enabled: boolean) => {
      const namePath = PARAM_NAME_MAP[key];

      if (!enabled) {
        const currentValue = form.getFieldValue(namePath);
        if (typeof currentValue === 'number') {
          lastValuesRef.current[key] = currentValue;
        }
        form.setFieldValue(namePath, undefined);
        return;
      }

      const fallback = lastValuesRef.current[key];
      const nextValue = typeof fallback === 'number' ? fallback : PARAM_DEFAULTS[key];
      lastValuesRef.current[key] = nextValue;
      form.setFieldValue(namePath, nextValue);
    },
    [form],
  );

  const paramItems: FormItemProps[] = (Object.keys(PARAM_CONFIG) as ParamKey[]).map((key) => {
    const meta = PARAM_CONFIG[key];
    const enabled = enabledMap[key];

    return {
      children: (
        <SliderWithCheckbox
          checked={enabled}
          disabled={!enabled}
          max={meta.slider.max}
          min={meta.slider.min}
          onToggle={(checked) => handleToggle(key, checked)}
          step={meta.slider.step}
          styles={styles}
        />
      ),
      desc: t(meta.descKey as any),
      label: (
        <Flexbox align={'center'} className={styles.label} gap={8} horizontal>
          {t(meta.labelKey as any)}
          <InfoTooltip title={t(meta.descKey as any)} />
        </Flexbox>
      ),
      name: PARAM_NAME_MAP[key],
      tag: meta.tag,
    } satisfies FormItemProps;
  });

  const model: FormGroupItemType = {
    children: [
      {
        children: <ModelSelect />,
        desc: t('settingModel.model.desc', { provider: providerName }),
        label: t('settingModel.model.title'),
        name: '_modalConfig',
        tag: 'model',
      },
      {
        children: <Switch />,
        desc: t('settingChat.enableStreaming.desc'),
        label: t('settingChat.enableStreaming.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: ['chatConfig', 'enableStreaming'],
        valuePropName: 'checked',
      },
      ...paramItems,
      {
        children: <Switch />,
        label: t('settingModel.enableMaxTokens.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: ['chatConfig', 'enableMaxTokens'],
        valuePropName: 'checked',
      },
      {
        children: (
          <SliderWithInput
            disabled={!enableMaxTokens}
            max={32_000}
            min={0}
            step={100}
            unlimitedInput
          />
        ),
        desc: t('settingModel.maxTokens.desc'),
        divider: false,
        hidden: !enableMaxTokens,
        label: t('settingModel.maxTokens.title'),
        name: ['params', 'max_tokens'],
        tag: 'max_tokens',
      },
      {
        children: <Switch />,
        label: t('settingModel.enableReasoningEffort.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: ['chatConfig', 'enableReasoningEffort'],
        valuePropName: 'checked',
      },
      {
        children: (
          <Select
            defaultValue="medium"
            options={[
              { label: t('settingModel.reasoningEffort.options.low'), value: 'low' },
              { label: t('settingModel.reasoningEffort.options.medium'), value: 'medium' },
              { label: t('settingModel.reasoningEffort.options.high'), value: 'high' },
            ]}
          />
        ),
        desc: t('settingModel.reasoningEffort.desc'),
        hidden: !enableReasoningEffort,
        label: t('settingModel.reasoningEffort.title'),
        name: ['params', 'reasoning_effort'],
        tag: 'reasoning_effort',
      },
    ],
    title: t('settingModel.title'),
  };

  return (
    <Form
      footer={
        <Form.SubmitFooter
          texts={{
            reset: t('submitFooter.reset'),
            submit: t('settingModel.submit'),
            unSaved: t('submitFooter.unSaved'),
            unSavedWarning: t('submitFooter.unSavedWarning'),
          }}
        />
      }
      form={form}
      initialValues={{
        ...config,
        _modalConfig: {
          model: config.model,
          provider: config.provider,
        },
      }}
      items={[model]}
      itemsType={'group'}
      onFinish={({ _modalConfig, ...rest }) => {
        // 清理 params 中的 undefined 和 null 值，确保禁用的参数被正确移除
        const cleanedRest = { ...rest };
        if (cleanedRest.params) {
          const cleanedParams = { ...cleanedRest.params };
          (Object.keys(cleanedParams) as Array<keyof typeof cleanedParams>).forEach((key) => {
            // 使用 null 作为禁用标记（JSON 可以序列化 null，而 undefined 会被忽略）
            if (cleanedParams[key] === undefined) {
              cleanedParams[key] = null as any;
            }
          });
          cleanedRest.params = cleanedParams as any;
        }

        updateConfig({
          model: _modalConfig?.model,
          provider: _modalConfig?.provider,
          ...cleanedRest,
        });
      }}
      variant={'borderless'}
      {...FORM_STYLE}
    />
  );
});

export default AgentModal;
