import { memo } from 'react';

import Intervention from '../Messages/AssistantGroup/Tool/Detail/Intervention';
import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { useStyles } from './style';

interface InterventionContentProps {
  intervention: PendingIntervention;
}

const InterventionContent = memo<InterventionContentProps>(({ intervention }) => {
  const { styles } = useStyles();

  return (
    <div className={styles.content}>
      <Intervention
        apiName={intervention.apiName}
        id={intervention.toolMessageId}
        identifier={intervention.identifier}
        requestArgs={intervention.requestArgs}
        toolCallId={intervention.toolCallId}
      />
    </div>
  );
});

export default InterventionContent;
