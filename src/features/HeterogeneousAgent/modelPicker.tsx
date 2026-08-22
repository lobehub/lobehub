import { createStaticStyles } from 'antd-style';
import type { LobeDefaultAiModelListItem } from 'model-bank';

import { ModelItemRender, TAG_CLASSNAME } from '@/components/ModelSelect';

export const MODEL_PICKER_STYLE = { minWidth: 200, width: 'initial' } as const;

export const modelPickerStyles = createStaticStyles(({ css }) => ({
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
