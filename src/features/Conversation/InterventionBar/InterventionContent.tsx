import { memo } from 'react';

import Intervention from '../Messages/AssistantGroup/Tool/Detail/Intervention';
import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { styles } from './style';
import UserInterventionErrorBoundary from './UserInterventionErrorBoundary';

interface InterventionContentProps {
  actionsPortalTarget: HTMLDivElement | null;
  intervention: PendingIntervention;
}

const InterventionContent = memo<InterventionContentProps>(
  ({ intervention, actionsPortalTarget }) => {
    const boundaryKey = [
      intervention.apiName,
      intervention.identifier,
      intervention.requestArgs,
      intervention.toolCallId,
      intervention.toolMessageId,
    ].join('|');

    return (
      <div className={styles.content}>
        <UserInterventionErrorBoundary
          apiName={intervention.apiName}
          identifier={intervention.identifier}
          key={boundaryKey}
          requestArgs={intervention.requestArgs}
          toolCallId={intervention.toolCallId}
        >
          <Intervention
            actionsPortalTarget={actionsPortalTarget}
            apiName={intervention.apiName}
            assistantGroupId={intervention.assistantGroupId}
            id={intervention.toolMessageId}
            identifier={intervention.identifier}
            requestArgs={intervention.requestArgs}
            toolCallId={intervention.toolCallId}
          />
        </UserInterventionErrorBoundary>
      </div>
    );
  },
);

export default InterventionContent;
