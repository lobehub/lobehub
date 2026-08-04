import { isWidgetSectionVisible } from '@/features/Home/CustomizeModal/config';

export const filterHiddenWidgetSections = <T extends { key: string }>(
  sections: T[],
  hiddenWidgets: string[],
): T[] => sections.filter(({ key }) => isWidgetSectionVisible(key, hiddenWidgets));
