import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HOME_MODEL_SHORTCUT_CLICKED_EVENT,
  trackHomeModelShortcutClicked,
} from './starterListAnalytics';

const trackProductUsageEvent = vi.hoisted(() => vi.fn());

vi.mock('@/libs/analytics/productUsageEvent', () => ({
  trackProductUsageEvent,
}));

describe('starter list analytics', () => {
  beforeEach(() => {
    trackProductUsageEvent.mockReset();
  });

  it('tracks a chat shortcut with its effective provider', async () => {
    trackProductUsageEvent.mockResolvedValue(true);

    const tracked = await trackHomeModelShortcutClicked({
      item: {
        model: 'glm-5.2',
        title: 'GLM-5.2',
        type: 'chat',
      },
      provider: 'zhipu',
    });

    expect(tracked).toBe(true);
    expect(trackProductUsageEvent).toHaveBeenCalledWith(
      {
        name: HOME_MODEL_SHORTCUT_CLICKED_EVENT,
        properties: {
          model: 'glm-5.2',
          model_type: 'chat',
          provider: 'zhipu',
          spm: 'homepage.model_shortcut.clicked',
        },
      },
      { analytics: undefined },
    );
  });

  it('tracks image shortcuts without an unavailable provider', async () => {
    trackProductUsageEvent.mockResolvedValue(true);

    await trackHomeModelShortcutClicked({
      item: {
        model: 'gpt-image-2',
        title: 'GPT Image 2',
        type: 'image',
      },
    });

    expect(trackProductUsageEvent).toHaveBeenCalledWith(
      {
        name: HOME_MODEL_SHORTCUT_CLICKED_EVENT,
        properties: {
          model: 'gpt-image-2',
          model_type: 'image',
          spm: 'homepage.model_shortcut.clicked',
        },
      },
      { analytics: undefined },
    );
  });
});
