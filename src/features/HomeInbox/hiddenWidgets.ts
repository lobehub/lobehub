import {
  HOME_INBOX_WIDGET_KEYS,
  isWidgetSectionVisible,
} from '@/features/Home/CustomizeModal/config';

export const filterHiddenWidgetSections = <T extends { key: string }>(
  sections: T[],
  hiddenWidgets: string[],
): T[] => sections.filter(({ key }) => isWidgetSectionVisible(key, hiddenWidgets));

interface ColumnWidgetInput {
  hiddenWidgets: string[];
  hideNeedsYou?: boolean;
  hideUnread?: boolean;
}

export const hasVisibleRailWidget = ({
  hiddenWidgets,
  hideNeedsYou,
  hideUnread,
}: ColumnWidgetInput): boolean =>
  HOME_INBOX_WIDGET_KEYS.some((key) => {
    if (hideNeedsYou && key === 'needsYou') return false;
    if (hideUnread && key === 'unread') return false;

    return !hiddenWidgets.includes(key);
  });
