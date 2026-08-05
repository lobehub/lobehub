export const HOME_WIDGET_KEYS = ['needsYou', 'unread', 'running', 'news', 'suggestions'] as const;

export type HomeWidgetKey = (typeof HOME_WIDGET_KEYS)[number];

export const HOME_CUSTOMIZE_DEFAULTS = {
  hiddenHomeWidgets: [] as string[],
  homeRecentsCount: 8,
  homeTaskCount: 8,
  showHomePortrait: true,
};

export const HOME_COUNT_MIN = 3;
export const HOME_COUNT_MAX = 15;

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
