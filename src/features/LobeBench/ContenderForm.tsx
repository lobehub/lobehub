'use client';

import type { EvalRunChatConfig, LobeAgentChatConfig } from '@lobechat/types';
import { Button, createModal, Flexbox, Input, Slider, Text, useModalContext } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { t as translate } from 'i18next';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createStore as createChatInputStore,
  Provider as ChatInputStoreProvider,
} from '@/features/ChatInput/store';
import {
  CONTENDER_SETTING_KEYS,
  describeSettings,
  type LobeBenchContender,
} from '@/features/LobeBench/lobeBench';
import ModelSelect from '@/features/ModelSelect';
import ControlsForm from '@/features/ModelSwitchPanel/components/ControlsForm/ControlsForm';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

interface ContenderFormProps {
  /** An existing contender to edit; its id is kept. */
  initial?: LobeBenchContender;
  onSubmit: (contender: LobeBenchContender) => void;
  /** The submit button's label; "Add to experiment" by default. */
  submitLabel?: string;
}

/** The contender settings in a chatConfig patch from the model-params form; nothing else is sent. */
const pickContenderSettings = (config: Partial<LobeAgentChatConfig>): EvalRunChatConfig =>
  Object.fromEntries(
    CONTENDER_SETTING_KEYS.filter((key) => config[key] !== undefined && config[key] !== null).map(
      (key) => [key, config[key]],
    ),
  ) as EvalRunChatConfig;

/**
 * Builds one contender: a model from the product's own model list plus the
 * settings it runs with. The model's own settings (reasoning switch and effort,
 * thinking level, verbosity …) come from the chat model-params form, so each
 * model shows the controls it has in chat. Sampling left at
 * "model default" is not sent.
 */
const ContenderForm = memo<ContenderFormProps>(({ initial, onSubmit, submitLabel }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  const [target, setTarget] = useState<{ model: string; provider: string } | undefined>(
    initial && { model: initial.model, provider: initial.provider },
  );
  const [name, setName] = useState(initial?.name ?? '');
  const [temperature, setTemperature] = useState<number | undefined>(initial?.params?.temperature);
  const [topP, setTopP] = useState<number | undefined>(initial?.params?.top_p);
  const [settings, setSettings] = useState<EvalRunChatConfig>(initial?.chatConfig ?? {});
  const enabledModels = useAiInfraStore((s) => s.enabledChatModelList || []);
  const extendParams = useAiInfraStore((s) =>
    target ? aiModelSelectors.modelExtendParams(target.model, target.provider)(s) : undefined,
  );

  const modelInfo = useMemo(() => {
    if (!target) return undefined;
    for (const provider of enabledModels) {
      if (provider.id !== target.provider) continue;
      const found = provider.children?.find((model) => model.id === target.model);
      if (found) return found;
    }
    return undefined;
  }, [enabledModels, target]);

  const labels = {
    reasoning: t('lobeBench.contender.settings.reasoning'),
    temperature: t('lobeBench.contender.settings.temperature'),
    topP: t('lobeBench.contender.settings.topP'),
  };
  const params = {
    ...(temperature !== undefined && { temperature }),
    ...(topP !== undefined && { top_p: topP }),
  };
  // A model with a reasoning switch runs with reasoning off until it is turned on
  // (the product default), so the contender says so instead of "default settings".
  const chatConfig = pickContenderSettings({
    ...(extendParams?.includes('enableReasoning') && { enableReasoning: false }),
    ...settings,
  });
  const settingsLabel =
    describeSettings(params, chatConfig, labels) || t('lobeBench.contender.settings.default');
  const defaultName = target ? `${modelInfo?.displayName ?? target.model} · ${settingsLabel}` : '';

  const submit = () => {
    if (!target) return;
    onSubmit({
      ...(Object.keys(chatConfig).length > 0 && { chatConfig }),
      id: initial?.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      model: target.model,
      name: name.trim() || defaultName,
      ...(Object.keys(params).length > 0 && { params }),
      provider: target.provider,
    });
    close();
  };

  return (
    <Flexbox gap={16}>
      <Text type={'secondary'}>{t('lobeBench.contender.subtitle')}</Text>
      <Flexbox gap={6}>
        <Text weight={500}>{t('lobeBench.contender.model')}</Text>
        <ModelSelect
          placeholder={t('lobeBench.contender.model.placeholder')}
          requiredAbilities={['functionCall']}
          value={target}
          variant={'filled'}
          onChange={(value) => {
            setTarget(value as { model: string; provider: string });
            // Another model has other settings.
            setSettings({});
          }}
        />
      </Flexbox>
      <Flexbox gap={6}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text weight={500}>{t('lobeBench.contender.temperature')}</Text>
          <Text type={'secondary'}>
            {temperature === undefined ? t('lobeBench.contender.modelDefault') : temperature}
          </Text>
        </Flexbox>
        <Slider
          max={2}
          min={0}
          step={0.1}
          value={temperature ?? 1}
          onChange={(value) => setTemperature(value as number)}
        />
      </Flexbox>
      <Flexbox gap={6}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text weight={500}>{t('lobeBench.contender.topP')}</Text>
          <Text type={'secondary'}>
            {topP === undefined ? t('lobeBench.contender.modelDefault') : topP}
          </Text>
        </Flexbox>
        <Slider
          max={1}
          min={0}
          step={0.05}
          value={topP ?? 1}
          onChange={(value) => setTopP(value as number)}
        />
      </Flexbox>
      {target && extendParams && extendParams.length > 0 && (
        <Flexbox gap={6}>
          <Text weight={500}>{t('lobeBench.contender.modelSettings')}</Text>
          {/* The chat form reads its Agent from a chat input; this one edits no Agent. */}
          <ChatInputStoreProvider createStore={() => createChatInputStore({ agentId: '' })}>
            <ControlsForm
              chatConfig={settings}
              model={target.model}
              provider={target.provider}
              onChatConfigChange={async (patch) => {
                // The form writes back what it was given; an unchanged value must not re-render it.
                setSettings((previous) => {
                  const next = { ...previous, ...pickContenderSettings(patch) };
                  return isEqual(next, previous) ? previous : next;
                });
              }}
            />
          </ChatInputStoreProvider>
        </Flexbox>
      )}
      <Flexbox gap={6}>
        <Text weight={500}>{t('lobeBench.contender.name')}</Text>
        <Input
          placeholder={defaultName || t('lobeBench.contender.name.placeholder')}
          value={name}
          variant={'filled'}
          onChange={(e) => setName(e.target.value)}
        />
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button onClick={close}>{t('lobeBench.new.cancel')}</Button>
        <Button disabled={!target} type={'primary'} onClick={submit}>
          {submitLabel ?? t('lobeBench.contender.save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

ContenderForm.displayName = 'LobeBenchContenderForm';

/** Opens the contender form in a modal; `onSubmit` gets the contender once saved. */
export const openContenderModal = (
  onSubmit: (contender: LobeBenchContender) => void,
  title?: string,
  submitLabel?: string,
  initial?: LobeBenchContender,
) =>
  createModal({
    content: <ContenderForm initial={initial} submitLabel={submitLabel} onSubmit={onSubmit} />,
    footer: null,
    title: title ?? translate('lobeBench.contender.title', { ns: 'eval' }),
    width: 520,
  });

export default ContenderForm;
