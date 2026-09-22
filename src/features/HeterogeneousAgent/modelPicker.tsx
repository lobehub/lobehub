import type { ServerDefaultHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import { createStaticStyles } from 'antd-style';
import type { LobeDefaultAiModelListItem } from 'model-bank';

import { ModelItemRender, TAG_CLASSNAME } from '@/components/ModelSelect';

export const MODEL_PICKER_STYLE = { minWidth: 200, width: 'initial' } as const;

/** Closed trigger next to the composer send button — hug the label, cap growth. */
export const COMPACT_MODEL_PICKER_STYLE = { maxWidth: 160, minWidth: 0, width: 'auto' } as const;

interface ServerDefaultModel {
  model: string;
}

/** A server deployed before an agent was added can omit that agent's model entry. */
export const resolveServerDefaultAgentModels = (
  models: Partial<Record<ServerDefaultHeterogeneousAgentType, ServerDefaultModel[]>> | undefined,
  agentType: ServerDefaultHeterogeneousAgentType | undefined,
): ServerDefaultModel[] => (agentType ? (models?.[agentType] ?? []) : []);

export const modelPickerStyles = createStaticStyles(({ css }) => ({
  compactLabel: css`
    overflow: hidden;

    min-width: 0;
    max-width: 100%;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  picker: css`
    .${TAG_CLASSNAME} {
      display: none;
    }
  `,
}));

export const resolveServerDefaultModelMeta = (
  model: string,
  builtinAiModelList: LobeDefaultAiModelListItem[],
) =>
  builtinAiModelList.find((item) => item.id === model && item.providerId === 'lobehub') ??
  builtinAiModelList.find((item) => item.id === model);

/** Closed-trigger text. Prefer Select's public `title`, not extra option fields. */
export const compactModelTriggerText = (option: { title?: string; value?: unknown }) => {
  const value = String(option.value ?? '');
  const modelId = value.includes('/') ? value.slice(value.indexOf('/') + 1) : value;
  return option.title || modelId;
};

export const buildServerDefaultModelOptions = (
  models: ServerDefaultModel[],
  builtinAiModelList: LobeDefaultAiModelListItem[],
) =>
  models.map(({ model }) => {
    const meta = resolveServerDefaultModelMeta(model, builtinAiModelList);
    const title = meta?.displayName ?? model;

    return {
      label: (
        <ModelItemRender
          displayName={meta?.displayName}
          id={model}
          releasedAt={meta?.releasedAt}
          showInfoTag={false}
        />
      ),
      title,
      value: model,
    };
  });
