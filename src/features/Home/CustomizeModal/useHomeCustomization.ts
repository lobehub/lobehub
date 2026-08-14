import { useCallback } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import {
  HOME_COUNT_MAX,
  HOME_COUNT_MIN,
  HOME_CUSTOMIZE_DEFAULTS,
  HOME_PRESETS,
  type HomePresetKey,
  type HomeWidgetKey,
  isHomeMinimalLayout,
  isHomeWidgetHidden,
  resolveHomePreset,
} from './config';

export const toggleHiddenWidget = (hidden: string[], key: HomeWidgetKey): string[] =>
  hidden.includes(key) ? hidden.filter((item) => item !== key) : [...hidden, key];

export const clampHomeCount = (value: number): number =>
  Math.min(HOME_COUNT_MAX, Math.max(HOME_COUNT_MIN, value));

interface HomeCustomization {
  applyPreset: (key: HomePresetKey) => void;
  hiddenWidgets: string[];
  isWidgetHidden: (key: HomeWidgetKey) => boolean;
  preset: HomePresetKey | undefined;
  recentsCount: number;
  reset: () => void;
  setRecentsCount: (value: number) => void;
  setTaskCount: (value: number) => void;
  showPortrait: boolean;
  taskCount: number;
  togglePortrait: () => void;
  toggleWidget: (key: HomeWidgetKey) => void;
}

export const useHomeMinimalLayout = (): boolean => {
  const hiddenWidgets = useGlobalStore(systemStatusSelectors.hiddenHomeWidgets);
  const showPortrait = useGlobalStore(systemStatusSelectors.showHomePortrait);

  return isHomeMinimalLayout({ hiddenWidgets, showPortrait });
};

export const useHomeCustomization = (): HomeCustomization => {
  const hiddenWidgets = useGlobalStore(systemStatusSelectors.hiddenHomeWidgets);
  const recentsCount = useGlobalStore(systemStatusSelectors.homeRecentsCount);
  const taskCount = useGlobalStore(systemStatusSelectors.homeTaskCount);
  const showPortrait = useGlobalStore(systemStatusSelectors.showHomePortrait);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const toggleWidget = useCallback(
    (key: HomeWidgetKey) => {
      updateSystemStatus(
        { hiddenHomeWidgets: toggleHiddenWidget(hiddenWidgets, key) },
        'homeCustomize',
      );
    },
    [hiddenWidgets, updateSystemStatus],
  );

  const togglePortrait = useCallback(() => {
    updateSystemStatus({ showHomePortrait: !showPortrait }, 'homeCustomize');
  }, [showPortrait, updateSystemStatus]);

  const setRecentsCount = useCallback(
    (value: number) => {
      updateSystemStatus({ homeRecentsCount: clampHomeCount(value) }, 'homeCustomize');
    },
    [updateSystemStatus],
  );

  const setTaskCount = useCallback(
    (value: number) => {
      updateSystemStatus({ homeTaskCount: clampHomeCount(value) }, 'homeCustomize');
    },
    [updateSystemStatus],
  );

  const applyPreset = useCallback(
    (key: HomePresetKey) => {
      const preset = HOME_PRESETS[key];

      updateSystemStatus(
        {
          hiddenHomeWidgets: [...preset.hiddenWidgets],
          homeRecentsCount: preset.count,
          homeTaskCount: preset.count,
          showHomePortrait: preset.showPortrait,
        },
        'homeCustomize',
      );
    },
    [updateSystemStatus],
  );

  const reset = useCallback(() => {
    updateSystemStatus(HOME_CUSTOMIZE_DEFAULTS, 'homeCustomize');
  }, [updateSystemStatus]);

  const isWidgetHidden = useCallback(
    (key: HomeWidgetKey) => isHomeWidgetHidden(key, hiddenWidgets),
    [hiddenWidgets],
  );

  return {
    applyPreset,
    hiddenWidgets,
    isWidgetHidden,
    preset: resolveHomePreset({ hiddenWidgets, showPortrait }),
    recentsCount,
    reset,
    setRecentsCount,
    setTaskCount,
    showPortrait,
    taskCount,
    toggleWidget,
    togglePortrait,
  };
};
