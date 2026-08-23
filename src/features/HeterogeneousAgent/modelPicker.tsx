import { createStaticStyles } from 'antd-style';
import type { LobeDefaultAiModelListItem } from 'model-bank';

import { ModelItemRender, TAG_CLASSNAME } from '@/components/ModelSelect';

export const MODEL_PICKER_STYLE = { minWidth: 200, width: 'initial' } as const;

/** Closed trigger next to the composer send button — hug the label, cap growth. */
export const COMPACT_MODEL_PICKER_STYLE = { maxWidth: 160, minWidth: 0, width: 'auto' } as const;

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

export const buildServerDefaultModelOptions = (
  models: Array<{ model: string }>,
  builtinAiModelList: LobeDefaultAiModelListItem[],
) =>
  models.map(({ model }) => {
    const meta = resolveServerDefaultModelMeta(model, builtinAiModelList);

    return {
      displayName: meta?.displayName ?? model,
      label: (
        <ModelItemRender
          displayName={meta?.displayName}
          id={model}
          releasedAt={meta?.releasedAt}
          showInfoTag={false}
        />
      ),
      value: model,
    };
  });
