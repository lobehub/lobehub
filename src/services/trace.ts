import { API_ENDPOINTS } from '@/services/_url';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import { type TraceEventBasePayload, type TraceEventPayloads } from '@/types/trace';

class TraceService {
  private request = async <T>(data: T) => {
    try {
      return fetch(API_ENDPOINTS.trace, {
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
    } catch (e) {
      console.error(e);
    }
  };

  traceEvent = async (data: TraceEventPayloads & TraceEventBasePayload) => {
    const enabled = userGeneralSettingsSelectors.telemetry(useUserStore.getState());

    if (!enabled) return;

    return this.request(data);
  };
}

export const traceService = new TraceService();
