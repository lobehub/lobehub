import { memo } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';

import Intervention from '../Messages/AssistantGroup/Tool/Detail/Intervention';
import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { styles } from './style';

interface InterventionContentProps {
  actionsPortalTarget: HTMLDivElement | null;
  intervention: PendingIntervention;
}

const InterventionContent = memo<InterventionContentProps>(
  ({ intervention, actionsPortalTarget }) => {
    const resetKeys = [
      intervention.apiName,
      intervention.identifier,
      intervention.requestArgs,
      intervention.toolCallId,
      intervention.toolMessageId,
    ];

    return (
      <div className={styles.content}>
        <SafeBoundary
          alertTitle={`${intervention.identifier} / ${intervention.apiName}`}
          resetKeys={resetKeys}
          variant="alert"
          onError={(error, info) => {
            console.error('[UserInterventionErrorBoundary] Caught error in intervention render:', {
              apiName: intervention.apiName,
              componentStack: info.componentStack,
              error: error instanceof Error ? error.message : String(error),
              identifier: intervention.identifier,
              toolCallId: intervention.toolCallId,
            });
          }}
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
        </SafeBoundary>
      </div>
    );
  },
);

export default InterventionContent;
