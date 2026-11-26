import { useState } from 'react';

interface SidebarGroup<GroupKey, TabKey> {
  items: { key: TabKey }[];
  key: GroupKey;
}

/**
 * Open groups of a settings sidebar, with `collapsedGroup` starting closed.
 * Tracked as the closed set, so groups that appear later (permissions resolve
 * after first paint) open by default. Landing on a page inside a closed group
 * reopens it, including when the page's entry only appears later, so the
 * active item is never hidden; collapsing the group of the current page
 * afterwards stays the user's choice.
 */
export const useExpandedSettingsGroups = <GroupKey, TabKey>(
  groups: SidebarGroup<GroupKey, TabKey>[],
  activeTab: TabKey,
  collapsedGroup: GroupKey,
) => {
  const activeGroup = groups.find((group) =>
    group.items.some((item) => item.key === activeTab),
  )?.key;

  const [closedGroups, setClosedGroups] = useState<GroupKey[]>([collapsedGroup]);
  const [revealed, setRevealed] = useState<{ group?: GroupKey; tab: TabKey }>();

  if (revealed?.tab !== activeTab || revealed.group !== activeGroup) {
    setRevealed({ group: activeGroup, tab: activeTab });
    setClosedGroups(closedGroups.filter((key) => key !== activeGroup));
  }

  const groupKeys = groups.map((group) => group.key);

  return {
    expandedGroups: groupKeys.filter((key) => !closedGroups.includes(key)),
    onExpandedGroupsChange: (next: GroupKey[]) => {
      setClosedGroups(groupKeys.filter((key) => !next.includes(key)));
    },
  };
};
