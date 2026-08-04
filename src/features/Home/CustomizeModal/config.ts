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

export const HOME_SECTION_WIDGET: Record<string, HomeWidgetKey> = {
  'needsYou': 'needsYou',
  'needsYou-error': 'needsYou',
  'needsYou-loading': 'needsYou',
  'news': 'news',
  'running': 'running',
  'topics-error': 'unread',
  'unread': 'unread',
};

export const isWidgetSectionVisible = (sectionKey: string, hidden: string[]): boolean => {
  const widget = HOME_SECTION_WIDGET[sectionKey];
  return !widget || !hidden.includes(widget);
};
