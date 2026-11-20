import { publishResourceEvent } from '@/server/services/resourceEvents';
import { after } from '@/server/utils/scheduleAfterResponse';

export type AcceptanceChange = 'comments' | 'session';

export const notifyAcceptance = (acceptanceId: string, change: AcceptanceChange, actorId = '') =>
  after(() =>
    publishResourceEvent(
      { id: acceptanceId, type: 'acceptance' },
      {
        actorId,
        type: change === 'comments' ? 'acceptance.commentsChanged' : 'acceptance.sessionChanged',
      },
    ),
  );
