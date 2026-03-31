import { memo, useState } from 'react';

import Intervention from '../Messages/AssistantGroup/Tool/Detail/Intervention';
import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { useStyles } from './style';

interface InterventionContentProps {
  intervention: PendingIntervention;
}

const InterventionContent = memo<InterventionContentProps>(({ intervention }) => {
  const { styles } = useStyles();
  const [actionsContainer, setActionsContainer] = useState<HTMLDivElement | null>(null);

  return (
    <>
      <div className={styles.content}>
        <Intervention
          actionsPortalTarget={actionsContainer}
          apiName={intervention.apiName}
          assistantGroupId={intervention.assistantGroupId}
          id={intervention.toolMessageId}
          identifier={intervention.identifier}
          requestArgs={intervention.requestArgs}
          toolCallId={intervention.toolCallId}
        />
      </div>
      <div className={styles.actions} ref={setActionsContainer} />
    </>
  );
});

export default InterventionContent;
