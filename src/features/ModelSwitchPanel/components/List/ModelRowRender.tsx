import { Icon, Tag } from '@lobehub/ui';
import { LockIcon } from 'lucide-react';
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
  /** Tag after the name, e.g. what sets a featured model apart. */
  badge?: string;
  /** The viewer cannot pick this model: a lock marks the row the panel dims. */
  disabled?: boolean;
  isActive?: boolean;
  model: AiModelForSelect;
  newLabel: string;
  /** Text for the price column when the model has no price to compare, e.g. a featured model. */
  pricePlaceholder?: string;
  proBadgeLabel?: string;
  provider: string;
}

/** One model row of the switch panel: name, reasoning effort and comparison meta. */
export const ModelRowRender = memo<ModelRowRenderProps>(
  ({
    activeEffortLabel,
    badge,
    disabled,
    isActive,
    model,
    newLabel,
    pricePlaceholder,
    proBadgeLabel,
    provider,
  }) => {
    const effortLabel = useModelEffortLabel(model.id, provider);

    return (
      <ModelItemRender
        {...model}
        {...model.abilities}
        newBadgeLabel={newLabel}
        proBadgeLabel={proBadgeLabel}
        provider={provider}
        secondaryText={(isActive && activeEffortLabel) || effortLabel}
        extra={
          <ModelRowMeta model={model} pricePlaceholder={pricePlaceholder} provider={provider} />
        }
        nameSuffix={
          <>
            {model.abilities?.imageOutput && <ImageOutputMark />}
            {disabled && <Icon aria-hidden icon={LockIcon} size={12} style={{ flex: 'none' }} />}
            {badge && (
              <Tag color="green" size="small" style={{ flex: 'none' }}>
                {badge}
              </Tag>
            )}
          </>
        }
      />
    );
  },
);

ModelRowRender.displayName = 'ModelRowRender';
