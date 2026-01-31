import { Form, type FormItemProps, SliderWithInput, Tag } from '@lobehub/ui';
import { Checkbox, Flexbox } from '@lobehub/ui';
import { Form as AntdForm, Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import { debounce } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import type { CSSProperties, ComponentType } from 'react';
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
  Component: ComponentType<any>;
  checked: boolean;
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
          <Component disabled={disabled} onChange={onChange} value={value} />
        </div>
      </div>
    );
  },
);

// Wrapper component for SliderWithInput with checkbox
interface SliderControlWrapperProps {
  checked: boolean;
  /**
   * 是否显示输入框的上下调整按钮
   * 注意：@lobehub/ui SliderWithInput 只在 size="small" 时才支持此属性
   */
  controls?: boolean;
  disabled: boolean;
  /**
   * 输入框宽度
   */
  inputWidth?: number;
  max: number;
  min: number;
  onChange?: (value: number) => void;
  onToggle: (checked: boolean) => void;
  /**
   * 输入框尺寸，设为 "small" 以支持 controls 属性
   */
  size?: 'small' | 'middle' | 'large';
  step: number;
  styles: any;
  unlimitedInput?: boolean;
  /**
   * 使用动态步长，根据当前值自动调整滚轮步长
   */
  useDynamicStep?: boolean;
  value?: number;
}

const getDynamicStep = (value: number | undefined, baseStep: number): number => {
  const current = value ?? 0;
  const Kibi = 1024;

  if (current <= Kibi) return baseStep; // 小值使用基础步长
  if (current < 8 * Kibi) return Kibi; // 1k ~ 8k 使用 1024 步长
  return 4 * Kibi; // > 8k 使用 4096 步长
};

/**
 * 根据数值位数计算合适的字体大小
 * 5位数及以下使用标准字号，超过5位数缩小字号
 */
const getInputFontSize = (value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const digits = String(Math.abs(value)).length;
  if (digits <= 5) return undefined; // 使用默认字号
  return 11; // 6位数及以上使用较小字号
};

const SliderControlWrapper = memo<SliderControlWrapperProps>(
  ({
    value,
    onChange,
    disabled,
    checked,
    onToggle,
    min,
    max,
    step,
    unlimitedInput,
    useDynamicStep,
    controls,
    size,
    inputWidth = 64,
    styles,
  }) => {
    const effectiveStep = useDynamicStep ? getDynamicStep(value, step) : step;
    const fontSize = getInputFontSize(value);

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
          <SliderWithInput
            changeOnWheel
            controls={controls}
            disabled={disabled}
            max={max}
            min={min}
            onChange={onChange}
            size={size}
            step={effectiveStep}
            styles={{
              input: {
                fontSize,
                maxWidth: inputWidth,
                minWidth: inputWidth,
              },
            }}
            unlimitedInput={unlimitedInput}
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

  const { frequency_penalty, presence_penalty, temperature, top_p, max_tokens } =
    config.params ?? {};
  const enableMaxTokens = config.chatConfig?.enableMaxTokens ?? false;

  const lastValuesRef = useRef<Record<ParamKey | 'max_tokens', number | undefined>>({
    frequency_penalty,
    max_tokens,
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
    if (typeof max_tokens === 'number') {
      lastValuesRef.current.max_tokens = max_tokens;
    }
  }, [config, form, frequency_penalty, max_tokens, presence_penalty, temperature, top_p]);

  const temperatureValue = AntdForm.useWatch(PARAM_NAME_MAP.temperature, form);
  const topPValue = AntdForm.useWatch(PARAM_NAME_MAP.top_p, form);
  const presencePenaltyValue = AntdForm.useWatch(PARAM_NAME_MAP.presence_penalty, form);
  const frequencyPenaltyValue = AntdForm.useWatch(PARAM_NAME_MAP.frequency_penalty, form);
  const maxTokensValue = AntdForm.useWatch(['params', 'max_tokens'], form);

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

  useEffect(() => {
    if (typeof maxTokensValue === 'number') {
      lastValuesRef.current.max_tokens = maxTokensValue;
    }
  }, [maxTokensValue]);

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

  // MaxTokens 的 toggle 处理
  const handleMaxTokensToggle = useCallback(
    async (enabled: boolean) => {
      const DEFAULT_MAX_TOKENS = 4096;
      let newMaxTokensValue: number | undefined;

      if (!enabled) {
        // 禁用时保存当前值
        const currentValue = form.getFieldValue(['params', 'max_tokens']);
        if (typeof currentValue === 'number') {
          lastValuesRef.current.max_tokens = currentValue;
        }
        newMaxTokensValue = undefined;
      } else {
        // 启用时恢复上次值或使用默认值
        const fallback = lastValuesRef.current.max_tokens;
        newMaxTokensValue = typeof fallback === 'number' ? fallback : DEFAULT_MAX_TOKENS;
        lastValuesRef.current.max_tokens = newMaxTokensValue;
      }

      // 更新表单
      form.setFieldValue(['chatConfig', 'enableMaxTokens'], enabled);
      form.setFieldValue(['params', 'max_tokens'], newMaxTokensValue);

      // 立即保存变更
      setUpdating(true);
      const currentValues = form.getFieldsValue();
      const updatedConfig = {
        ...currentValues,
        chatConfig: {
          ...currentValues.chatConfig,
          enableMaxTokens: enabled,
        },
        params: {
          ...currentValues.params,
          max_tokens: newMaxTokensValue,
        },
      };

      await updateAgentConfig(updatedConfig);
      setUpdating(false);
    },
    [form, setUpdating, updateAgentConfig],
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
          onToggle={(checked) => handleToggle(key, checked)}
          styles={styles}
          value={form.getFieldValue(PARAM_NAME_MAP[key])}
        />
      ),
      label: (
        <Flexbox align={'center'} className={styles.label} gap={8} horizontal>
          {t(meta.labelKey)}
          <InfoTooltip title={t(meta.descKey)} zIndex={1200} />
        </Flexbox>
      ),
      name: PARAM_NAME_MAP[key],
      tag: meta.tag,
    } satisfies FormItemProps;
  });

  const maxTokensItem: FormItemProps = {
    children: (
      <SliderControlWrapper
        checked={enableMaxTokens}
        controls={false}
        disabled={!enableMaxTokens}
        inputWidth={56}
        max={32_000}
        min={0}
        onToggle={handleMaxTokensToggle}
        size="small"
        step={100}
        styles={styles}
        unlimitedInput
        useDynamicStep
        value={form.getFieldValue(['params', 'max_tokens'])}
      />
    ),
    label: (
      <Flexbox align={'center'} className={styles.label} gap={8} horizontal>
        {t('settingModel.maxTokens.title')}
        <InfoTooltip title={t('settingModel.maxTokens.desc')} zIndex={1200} />
      </Flexbox>
    ),
    name: ['params', 'max_tokens'],
    tag: 'max_tokens',
  };

  // Context Compression items
  const contextCompressionItems: FormItemProps[] = [
    {
      children: <Switch />,
      label: (
        <Flexbox align={'center'} className={styles.label} gap={8} horizontal>
          {t('settingModel.enableContextCompression.title')}
          <InfoTooltip title={t('settingModel.enableContextCompression.desc')} />
        </Flexbox>
      ),
      name: ['chatConfig', 'enableContextCompression'],
      tag: 'compression',
      valuePropName: 'checked',
    },
  ];

  const allItems = [...baseItems, maxTokensItem, ...contextCompressionItems];

  return (
    <Form
      form={form}
      initialValues={config}
      itemMinWidth={220}
      items={
        mobile
          ? allItems.map((item) => ({ ...item, divider: false }))
          : allItems.map(({ tag, ...item }) => ({
              ...item,
              desc: <Tag size={'small'}>{tag}</Tag>,
              divider: false,
            }))
      }
      itemsType={'flat'}
      onValuesChange={handleValuesChange}
      styles={{
        group: {
          '--lobe-flex-gap': '24px',
          'background': 'transparent',
          'paddingBottom': 12,
        } as CSSProperties,
        item: {
          paddingBlock: 0,
        },
      }}
    />
  );
});

export default Controls;
