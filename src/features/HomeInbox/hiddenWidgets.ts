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
  hideRunning?: boolean;
  hideUnread?: boolean;
  /** Business-slot widget: only counts once the slot says it exists here. */
  usageActive?: boolean;
}

export const hasVisibleRailWidget = ({
  hiddenWidgets,
  hideNeedsYou,
  hideRunning,
  hideUnread,
  usageActive,
}: ColumnWidgetInput): boolean =>
  HOME_INBOX_WIDGET_KEYS.some((key) => {
    if (hideNeedsYou && key === 'needsYou') return false;
    if (hideRunning && key === 'running') return false;
    if (hideUnread && key === 'unread') return false;
    if (!usageActive && key === 'usage') return false;

    return !hiddenWidgets.includes(key);
  });
