import { type AiModelForSelect } from 'model-bank';
import { memo } from 'react';

import { ModelItemRender } from '@/components/ModelSelect';

import { useModelEffortLabel } from '../../hooks/useModelEffortLabel';
import { ImageOutputMark, ModelRowMeta } from './ModelRowMeta';

interface ModelRowRenderProps {
  /**
   * Effort label from the host for the active row. It wins over the saved
   * per-model default because a topic can pin its own effort for that model.
   */
  activeEffortLabel?: string;
  isActive?: boolean;
  model: AiModelForSelect;
  newLabel: string;
  proBadgeLabel?: string;
  provider: string;
}

/** One model row of the switch panel: name, reasoning effort and comparison meta. */
export const ModelRowRender = memo<ModelRowRenderProps>(
  ({ activeEffortLabel, isActive, model, newLabel, proBadgeLabel, provider }) => {
    const effortLabel = useModelEffortLabel(model.id, provider);

    return (
      <ModelItemRender
        {...model}
        {...model.abilities}
        extra={<ModelRowMeta model={model} provider={provider} />}
        nameSuffix={model.abilities?.imageOutput && <ImageOutputMark />}
        newBadgeLabel={newLabel}
        proBadgeLabel={proBadgeLabel}
        secondaryText={(isActive && activeEffortLabel) || effortLabel}
      />
    );
  },
);

ModelRowRender.displayName = 'ModelRowRender';
