import { memo } from 'react';

import Intervention from '../Messages/AssistantGroup/Tool/Detail/Intervention';
import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { styles } from './style';

interface InterventionContentProps {
  actionsPortalTarget: HTMLDivElement | null;
  intervention: PendingIntervention;
}

const InterventionContent = memo<InterventionContentProps>(
  ({ intervention, actionsPortalTarget }) => {
    return (
      <div className={styles.content}>
        <Intervention
          actionsPortalTarget={actionsPortalTarget}
          apiName={intervention.apiName}
          assistantGroupId={intervention.assistantGroupId}
          id={intervention.toolMessageId}
          identifier={intervention.identifier}
          requestArgs={intervention.requestArgs}
          toolCallId={intervention.toolCallId}
        />
      </div>
    );
  },
);

export default InterventionContent;
