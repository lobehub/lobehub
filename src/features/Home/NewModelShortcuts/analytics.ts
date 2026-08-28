import type { AnalyticsManager } from '@lobehub/analytics';

import type { HomeNewModelItem } from '@/business/client/hooks/useHomeNewModels';
import { trackProductUsageEvent } from '@/libs/analytics/productUsageEvent';

export const HOME_MODEL_SHORTCUT_CLICKED_EVENT = 'home_model_shortcut_clicked';

interface TrackHomeModelShortcutClickedParams {
  analytics?: AnalyticsManager | null;
  item: HomeNewModelItem;
  provider?: string;
}

export const trackHomeModelShortcutClicked = ({
  analytics,
  item,
  provider,
}: TrackHomeModelShortcutClickedParams) =>
  trackProductUsageEvent(
    {
      name: HOME_MODEL_SHORTCUT_CLICKED_EVENT,
      properties: {
        ...(provider && { provider }),
        model: item.model,
        model_type: item.type,
        spm: 'homepage.model_shortcut.clicked',
      },
    },
    { analytics },
  );
