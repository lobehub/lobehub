import { type SelectOptions } from '@lobehub/ui';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import { type ModelRef } from '../serviceModelState';
import ModelLabel from './ModelLabel';

/** `vision` is the chat models that can read images. */
export type ModelKind = 'asr' | 'chat' | 'embedding' | 'vision';

// lobe-design-ignore DETAIL-NO-EMPTY: with no enabled model the picker still offers its follow item, so the list is never empty
export const toOptionValue = ({ model, provider }: ModelRef) => `${provider}/${model}`;

/**
 * The enabled models of one kind as Select option groups, plus a resolver from
 * `{ provider, model }` to the option value it was rendered with.
 */
export const useModelOptions = (kind: ModelKind) => {
  const { t } = useTranslation('setting');
  const providers = useAiInfraStore((s) =>
    kind === 'embedding'
      ? aiProviderSelectors.enabledEmbeddingModelList(s)
      : kind === 'asr'
        ? aiProviderSelectors.enabledAsrModelList(s)
        : s.enabledChatModelList || [],
  );

  const groups = useMemo<SelectOptions>(() => {
    const withModels = providers
      .map((provider) =>
        kind === 'vision'
          ? {
              ...provider,
              children: provider.children.filter((model) => model.abilities?.vision),
            }
          : provider,
      )
      .filter((provider) => provider.children.length > 0);

    return withModels.map((provider) => ({
      // With one provider the group is just 「指定模型」; otherwise the provider
      // name tells apart the same model served by different providers.
      label: withModels.length === 1 ? t('serviceModel.customModel') : provider.name,
      options: provider.children.map((model) => ({
        label: <ModelLabel model={model.id} name={model.displayName || model.id} />,
        title: model.displayName || model.id,
        value: toOptionValue({ model: model.id, provider: provider.id }),
      })),
    }));
  }, [kind, providers, t]);

  /** Option value → model ref; the model id may itself contain slashes. */
  const parseValue = useCallback((value: string): ModelRef => {
    const [provider, ...rest] = value.split('/');
    return { model: rest.join('/'), provider };
  }, []);

  return { groups, parseValue };
};

/** Display name of any model, enabled or not, falling back to its id. */
export const useModelName = () => {
  const chat = useAiInfraStore((s) => s.enabledChatModelList);
  const embedding = useAiInfraStore(aiProviderSelectors.enabledEmbeddingModelList);
  const asr = useAiInfraStore(aiProviderSelectors.enabledAsrModelList);
  const builtin = useAiInfraStore((s) => s.builtinAiModelList);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of builtin) if (model.displayName) map.set(model.id, model.displayName);
    for (const provider of [...(chat || []), ...embedding, ...asr])
      for (const model of provider.children)
        if (model.displayName) map.set(model.id, model.displayName);
    return map;
  }, [asr, builtin, chat, embedding]);

  return useCallback((ref?: ModelRef) => (ref ? names.get(ref.model) || ref.model : ''), [names]);
};
