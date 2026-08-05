// The sections the inbox owns, which is also what the rail can host. Kept apart
// from the full key list because the main column's own blocks (recents, tasks)
// never appear in the rail — folding them in would keep the rail alive on the
// strength of a section it cannot show.
export const HOME_INBOX_WIDGET_KEYS = [
  'needsYou',
  'unread',
  'running',
  'news',
  'suggestions',
] as const;

export const HOME_WIDGET_KEYS = [...HOME_INBOX_WIDGET_KEYS, 'recents', 'tasks'] as const;

export type HomeInboxWidgetKey = (typeof HOME_INBOX_WIDGET_KEYS)[number];
export type HomeWidgetKey = (typeof HOME_WIDGET_KEYS)[number];

export const HOME_CUSTOMIZE_DEFAULTS = {
  hiddenHomeWidgets: [] as string[],
  homeRecentsCount: 8,
  homeTaskCount: 8,
  showHomePortrait: true,
};

export const HOME_COUNT_MIN = 3;
export const HOME_COUNT_MAX = 15;

export const HOME_PRESET_KEYS = ['minimal', 'balanced', 'full'] as const;

export type HomePresetKey = (typeof HOME_PRESET_KEYS)[number];

interface HomePreset {
  // Applied along with the preset, but left out of `resolveHomePreset`'s
  // comparison: how much a list shows is a separate axis from which sections
  // exist, and re-tuning it must not drop the page out of its preset.
  count: number;
  hiddenWidgets: readonly HomeWidgetKey[];
  showPortrait: boolean;
}

export const HOME_PRESETS: Record<HomePresetKey, HomePreset> = {
  balanced: {
    count: 5,
    hiddenWidgets: ['unread', 'running', 'news', 'suggestions'],
    showPortrait: false,
  },
  full: { count: 8, hiddenWidgets: [], showPortrait: true },
  minimal: { count: 5, hiddenWidgets: HOME_WIDGET_KEYS, showPortrait: false },
};

interface HomeVisibilityState {
  hiddenWidgets: string[];
  showPortrait: boolean;
}

const hiddenKeySet = ({ hiddenWidgets }: HomeVisibilityState): Set<string> =>
  new Set(HOME_WIDGET_KEYS.filter((key) => hiddenWidgets.includes(key)));

export const resolveHomePreset = (state: HomeVisibilityState): HomePresetKey | undefined => {
  const hidden = hiddenKeySet(state);

  return HOME_PRESET_KEYS.find((key) => {
    const preset = HOME_PRESETS[key];

    return (
      preset.showPortrait === state.showPortrait &&
      preset.hiddenWidgets.length === hidden.size &&
      preset.hiddenWidgets.every((widget) => hidden.has(widget))
    );
  });
};

// Nothing is left to stack under the composer, so the page stops being a
// dashboard: the greeting and the composer become one centered block. Derived
// from the switches rather than stored, so it can never disagree with them.
export const isHomeMinimalLayout = (state: HomeVisibilityState): boolean =>
  !state.showPortrait && HOME_WIDGET_KEYS.every((key) => state.hiddenWidgets.includes(key));

// An error banner covers every widget whose content it reports on, not just the
// one it is named after: the topic feed powers unread AND running, and the briefs
// fetch powers needsYou AND news. Narrowing either pair back to one key lets a
// hidden widget silence a failure that explains the other's absence.
const HOME_SECTION_WIDGET_COVERAGE: Record<string, HomeWidgetKey[]> = {
  'needsYou': ['needsYou'],
  'needsYou-error': ['needsYou', 'news'],
  'needsYou-loading': ['needsYou'],
  'news': ['news'],
  'running': ['running'],
  'topics-error': ['unread', 'running'],
  'unread': ['unread'],
};

export const isWidgetSectionVisible = (sectionKey: string, hidden: string[]): boolean => {
  const covered = HOME_SECTION_WIDGET_COVERAGE[sectionKey];
  return !covered || covered.some((widget) => !hidden.includes(widget));
};
