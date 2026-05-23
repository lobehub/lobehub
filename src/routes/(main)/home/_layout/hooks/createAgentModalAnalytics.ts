import type { AnalyticsManager } from '@lobehub/analytics';

import { trackProductUsageEvent } from '@/libs/analytics/productUsageEvent';

export type CreateAgentModalSubmitSource = 'blank' | 'manual' | 'example' | 'example_edited';

interface TrackCreateAgentModalCreationSucceededParams {
  analytics?: AnalyticsManager | null;
  source: CreateAgentModalSubmitSource;
  type: 'agent' | 'group';
}

export const trackCreateAgentModalCreationSucceeded = ({
  analytics,
  source,
  type,
}: TrackCreateAgentModalCreationSucceededParams) => {
  if (type !== 'agent') return Promise.resolve(false);

  return trackProductUsageEvent(
    {
      name: 'create_agent_modal_creation_succeeded',
      properties: {
        source,
        spm: 'home.create_agent_modal.submit',
        type,
      },
    },
    { analytics },
  );
};
