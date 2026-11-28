// Fixture: the success page polls the whole billing detail until the paid plan
// shows up. It stops on success only, so a webhook that never lands keeps it
// polling every 1.5 s for as long as the tab stays open.
import { useClientDataSWR } from '@/libs/swr';
import { workspaceService } from '@/services/workspace';

export const usePaidPlan = (workspaceId: string) =>
  useClientDataSWR(
    ['upgrade-success.billing', workspaceId],
    () => workspaceService.getBillingDetail(),
    {
      // alint-expect
      refreshInterval: (data) => (data?.plan && data.plan !== 'free' ? 0 : 1500),
    },
  );
