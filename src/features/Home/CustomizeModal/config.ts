// The sections HomeInbox owns. Kept apart from the full key list because the
// main column's standalone blocks (recents, tasks) are rendered by
// HomeModeContent rather than HomeInbox.
export const HOME_INBOX_WIDGET_KEYS = [
  'goals',
  'needsYou',
  'unread',
  'running',
  'news',
  'suggestions',
] as const;

export const HOME_WIDGET_KEYS = [
  ...HOME_INBOX_WIDGET_KEYS,
  'recents',
  'tasks',
  'scheduledTasks',
] as const;

export type HomeInboxWidgetKey = (typeof HOME_INBOX_WIDGET_KEYS)[number];
export type HomeWidgetKey = (typeof HOME_WIDGET_KEYS)[number];

/**
 * A flat list of nine switches makes the reader hold the whole page in their
 * head to find one section. The grouping that lets you find one without
 * reading them all is **where the section sits on Home** — you already know
 * which part of the page you want less of, so the panel is read by pointing at
 * it rather than by recalling a category name.
 *
 * That makes membership a fact about the page, not a taste call: the main
 * column carries the agent feeds and the two task blocks, and the rail carries
 * goals, news and suggestions (`RAIL_INBOX_PROPS` hides needs-you, running and
 * unread from the rail; `ownsRailSections` decides the rest). A widget that
 * moves columns must move groups with it.
 *
 * The order inside each group follows the page top-down, so scanning the panel
 * and scanning Home walk the same path.
 */
export const HOME_WIDGET_GROUPS = [
  { key: 'agent', widgets: ['unread', 'needsYou', 'running', 'recents'] },
  { key: 'task', widgets: ['tasks', 'scheduledTasks'] },
  { key: 'rail', widgets: ['goals', 'news', 'suggestions'] },
] as const satisfies ReadonlyArray<{ key: string; widgets: readonly HomeWidgetKey[] }>;

export type HomeWidgetGroupKey = (typeof HOME_WIDGET_GROUPS)[number]['key'];

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

/**
 * `scheduledTasks` rides on `tasks`: the two are one task overview split in
 * half, so switching the main list off must not leave the other half standing
 * under a different heading. It also keeps settings saved before this key
 * existed meaningful — a stored "minimal" selection lists every widget that
 * existed then, and without this fallback those pages would silently grow a
 * section back and drop out of their preset.
 */
export const isHomeWidgetHidden = (key: HomeWidgetKey, hiddenWidgets: string[]): boolean =>
  hiddenWidgets.includes(key) || (key === 'scheduledTasks' && hiddenWidgets.includes('tasks'));

const hiddenKeySet = ({ hiddenWidgets }: HomeVisibilityState): Set<string> =>
  new Set(HOME_WIDGET_KEYS.filter((key) => isHomeWidgetHidden(key, hiddenWidgets)));

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
  !state.showPortrait &&
  HOME_WIDGET_KEYS.every((key) => isHomeWidgetHidden(key, state.hiddenWidgets));

// An error banner covers every widget whose content it reports on, not just the
// one it is named after: the topic feed powers unread AND running, and the briefs
// fetch powers needsYou AND news. Narrowing either pair back to one key lets a
// hidden widget silence a failure that explains the other's absence.
const HOME_SECTION_WIDGET_COVERAGE: Record<string, HomeWidgetKey[]> = {
  'goals': ['goals'],
  'goals-error': ['goals'],
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
