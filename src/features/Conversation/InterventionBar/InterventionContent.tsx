import { memo } from 'react';

import Intervention from '../Messages/AssistantGroup/Tool/Detail/Intervention';
import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { styles } from './style';

interface InterventionContentProps {
  intervention: PendingIntervention;
}

const InterventionContent = memo<InterventionContentProps>(({ intervention }) => {
  return (
    <div className={styles.content}>
      <Intervention
        apiName={intervention.apiName}
        assistantGroupId={intervention.assistantGroupId}
        id={intervention.toolMessageId}
        identifier={intervention.identifier}
        requestArgs={intervention.requestArgs}
        toolCallId={intervention.toolCallId}
      />
    </div>
  );
});

export default InterventionContent;
