import { type FormItemProps } from '@lobehub/ui';
import { Checkbox, Flexbox, Form, SliderWithInput, Tag } from '@lobehub/ui';
import { Form as AntdForm, Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import { debounce } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import { type ComponentType } from 'react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import InfoTooltip from '@/components/InfoTooltip';
import {
  FrequencyPenalty,
  PresencePenalty,
  Temperature,
  TopP,
} from '@/features/ModelParamsControl';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

interface ControlsProps {
  setUpdating: (updating: boolean) => void;
  updating: boolean;
}

type ParamKey = 'temperature' | 'top_p' | 'presence_penalty' | 'frequency_penalty';

type ParamLabelKey =
  | 'settingModel.temperature.title'
  | 'settingModel.topP.title'
  | 'settingModel.presencePenalty.title'
  | 'settingModel.frequencyPenalty.title';

type ParamDescKey =
  | 'settingModel.temperature.desc'
  | 'settingModel.topP.desc'
  | 'settingModel.presencePenalty.desc'
  | 'settingModel.frequencyPenalty.desc';

const styles = createStaticStyles(({ css, cssVar }) => ({
  checkbox: css`
    .ant-checkbox-inner {
      border-radius: 4px;
    }

    &:hover .ant-checkbox-inner {
      border-color: ${cssVar.colorPrimary};
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

// Wrapper component to handle checkbox + slider
interface ParamControlWrapperProps {
  checked: boolean;
  Component: ComponentType<any>;
  disabled: boolean;
  onChange?: (value: number) => void;
  onToggle: (checked: boolean) => void;
  styles: any;
  value?: number;
}

const ParamControlWrapper = memo<ParamControlWrapperProps>(
  ({ Component, value, onChange, disabled, checked, onToggle, styles }) => {
    return (
      <div className={styles.sliderWrapper}>
        <Checkbox
          checked={checked}
          className={styles.checkbox}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(!checked);
          }}
        />
        <div style={{ flex: 1 }}>
          <Component disabled={disabled} value={value} onChange={onChange} />
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
    Component: FrequencyPenalty,
    descKey: 'settingModel.frequencyPenalty.desc',
    labelKey: 'settingModel.frequencyPenalty.title',
    tag: 'frequency_penalty',
  },
  presence_penalty: {
    Component: PresencePenalty,
    descKey: 'settingModel.presencePenalty.desc',
    labelKey: 'settingModel.presencePenalty.title',
    tag: 'presence_penalty',
  },
  temperature: {
    Component: Temperature,
    descKey: 'settingModel.temperature.desc',
    labelKey: 'settingModel.temperature.title',
    tag: 'temperature',
  },
  top_p: {
    Component: TopP,
    descKey: 'settingModel.topP.desc',
    labelKey: 'settingModel.topP.title',
    tag: 'top_p',
  },
} satisfies Record<
  ParamKey,
  {
    Component: ComponentType<any>;
    descKey: ParamDescKey;
    labelKey: ParamLabelKey;
    tag: string;
  }
>;

const Controls = memo<ControlsProps>(({ setUpdating }) => {
  const { t } = useTranslation('setting');
  const mobile = useServerConfigStore((s) => s.isMobile);
  const agentId = useAgentId();
  const { updateAgentConfig } = useUpdateAgentConfig();

  const config = useAgentStore((s) => agentByIdSelectors.getAgentConfigById(agentId)(s), isEqual);
  const [form] = Form.useForm();

  const enableMaxTokens = AntdForm.useWatch(['chatConfig', 'enableMaxTokens'], form);
  const { frequency_penalty, presence_penalty, temperature, top_p } = config.params ?? {};

  const lastValuesRef = useRef<Record<ParamKey, number | undefined>>({
    frequency_penalty,
    presence_penalty,
    temperature,
    top_p,
  });

  useEffect(() => {
    form.setFieldsValue(config);

    if (typeof temperature === 'number') lastValuesRef.current.temperature = temperature;
    if (typeof top_p === 'number') lastValuesRef.current.top_p = top_p;
    if (typeof presence_penalty === 'number') {
      lastValuesRef.current.presence_penalty = presence_penalty;
    }
    if (typeof frequency_penalty === 'number') {
      lastValuesRef.current.frequency_penalty = frequency_penalty;
    }
  }, [config, form, frequency_penalty, presence_penalty, temperature, top_p]);

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
    async (key: ParamKey, enabled: boolean) => {
      const namePath = PARAM_NAME_MAP[key];
      let newValue: number | undefined;

      if (!enabled) {
        const currentValue = form.getFieldValue(namePath);
        if (typeof currentValue === 'number') {
          lastValuesRef.current[key] = currentValue;
        }
        newValue = undefined;
        form.setFieldValue(namePath, undefined);
      } else {
        const fallback = lastValuesRef.current[key];
        const nextValue = typeof fallback === 'number' ? fallback : PARAM_DEFAULTS[key];
        lastValuesRef.current[key] = nextValue;
        newValue = nextValue;
        form.setFieldValue(namePath, nextValue);
      }

      // 立即保存变更 - 手动构造配置对象确保使用最新值
      setUpdating(true);
      const currentValues = form.getFieldsValue();
      const prevParams = (currentValues.params ?? {}) as Record<ParamKey, number | undefined>;
      const currentParams: Record<ParamKey, number | undefined> = { ...prevParams };

      if (newValue === undefined) {
        // 显式删除该属性，而不是设置为 undefined
        // 这样可以确保 Form 表单状态同步
        delete currentParams[key];
        // 使用 null 作为禁用标记（数据库会保留 null，前端据此判断复选框状态）
        currentParams[key] = null as any;
      } else {
        currentParams[key] = newValue;
      }

      const updatedConfig = {
        ...currentValues,
        params: currentParams,
      };

      await updateAgentConfig(updatedConfig);
      setUpdating(false);
    },
    [form, setUpdating, updateAgentConfig],
  );

  // 使用 useMemo 确保防抖函数只创建一次
  const handleValuesChange = useCallback(
    debounce(async (values) => {
      setUpdating(true);
      await updateAgentConfig(values);
      setUpdating(false);
    }, 500),
    [updateAgentConfig, setUpdating],
  );

  const baseItems: FormItemProps[] = (Object.keys(PARAM_CONFIG) as ParamKey[]).map((key) => {
    const meta = PARAM_CONFIG[key];
    const Component = meta.Component;
    const enabled = enabledMap[key];

    return {
      children: (
        <ParamControlWrapper
          Component={Component}
          checked={enabled}
          disabled={!enabled}
          styles={styles}
          value={form.getFieldValue(PARAM_NAME_MAP[key])}
          onToggle={(checked) => handleToggle(key, checked)}
        />
      ),
      label: (
        <Flexbox horizontal align={'center'} className={styles.label} gap={8}>
          {t(meta.labelKey)}
          <InfoTooltip title={t(meta.descKey)} />
        </Flexbox>
      ),
      name: PARAM_NAME_MAP[key],
      tag: meta.tag,
    } satisfies FormItemProps;
  });

  // MaxTokens items
  const maxTokensItems: FormItemProps[] = [
    {
      children: <Switch />,
      label: (
        <Flexbox horizontal align={'center'} className={styles.label} gap={8}>
          {t('settingModel.enableMaxTokens.title')}
        </Flexbox>
      ),
      name: ['chatConfig', 'enableMaxTokens'],
      tag: 'max_tokens',
      valuePropName: 'checked',
    },
    ...(enableMaxTokens
      ? [
          {
            children: <SliderWithInput unlimitedInput max={32_000} min={0} step={100} />,
            label: (
              <Flexbox horizontal align={'center'} className={styles.label} gap={8}>
                {t('settingModel.maxTokens.title')}
                <InfoTooltip title={t('settingModel.maxTokens.desc')} />
              </Flexbox>
            ),
            name: ['params', 'max_tokens'],
            tag: 'max_tokens',
          } satisfies FormItemProps,
        ]
      : []),
  ];

  // Context Compression items
  const contextCompressionItems: FormItemProps[] = [
    {
      children: <Switch />,
      label: (
        <Flexbox horizontal align={'center'} className={styles.label} gap={8}>
          {t('settingModel.enableContextCompression.title')}
          <InfoTooltip title={t('settingModel.enableContextCompression.desc')} />
        </Flexbox>
      ),
      name: ['chatConfig', 'enableContextCompression'],
      tag: 'compression',
      valuePropName: 'checked',
    },
  ];

  const allItems = [...baseItems, ...maxTokensItems, ...contextCompressionItems];

  return (
    <Form
      form={form}
      initialValues={config}
      itemMinWidth={220}
      itemsType={'flat'}
      items={
        mobile
          ? allItems
          : allItems.map(({ tag, ...item }) => ({
              ...item,
              desc: <Tag size={'small'}>{tag}</Tag>,
            }))
      }
      styles={{
        group: {
          background: 'transparent',
          paddingBottom: 12,
        },
      }}
      onValuesChange={handleValuesChange}
    />
  );
});

export default Controls;
