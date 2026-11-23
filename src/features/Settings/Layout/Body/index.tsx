'use client';

import { Accordion, Flexbox, Text } from '@lobehub/ui';
import { Fragment, memo, useMemo } from 'react';
import { Link } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import { getTabUrl, SearchSection } from '@/features/SettingsSearch';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { SettingsTabs } from '@/store/global/initialState';
import { isModifierClick } from '@/utils/navigation';

import { SettingsGroupKey, useCategory } from '../../hooks/useCategory';
import { useExpandedSettingsGroups } from '../../hooks/useExpandedSettingsGroups';
import { usePersonalSettingsSearchScope } from '../../hooks/useSettingsSearchScope';
import MemorySubNav from '../../memory/MemorySubNav';

const Body = memo(() => {
  const sectionTriggerStyle = useSectionTriggerStyle();
  const categoryGroups = useCategory();
  const searchScope = usePersonalSettingsSearchScope(categoryGroups);
  const navigate = useWorkspaceAwareNavigate();
  const location = useActiveLocation();

  // Extract current tab from pathname: /settings/profile -> profile
  const activeTab = useMemo(() => {
    const pathParts = location.pathname.split('/');
    // pathname is like /settings/profile or /settings/provider/xxx
    if (pathParts.length >= 3) {
      return pathParts[2] as SettingsTabs;
    }
    return SettingsTabs.Profile;
  }, [location.pathname]);

  // Only Memory lists its sub-pages here; other tabs keep their row active on `:sub`.
  const activeSubSection =
    activeTab === SettingsTabs.Memory ? location.pathname.split('/')[3] : undefined;

  const { expandedGroups, onExpandedGroupsChange } = useExpandedSettingsGroups(
    categoryGroups,
    activeTab,
    SettingsGroupKey.System,
  );

  return (
    <Flexbox gap={4} paddingInline={4}>
      <SearchSection scope={searchScope}>
        <Accordion
          gap={8}
          indicatorPlacement="inline"
          styles={{ trigger: sectionTriggerStyle }}
          value={expandedGroups}
          items={categoryGroups.map((group) => ({
            key: group.key,
            title: <SectionTitle>{group.title}</SectionTitle>,
            children: (
              <Flexbox gap={1} paddingBlock={1}>
                {group.items.map((item) => {
                  const url = item.href ?? getTabUrl(item.key);
                  return (
                    <Fragment key={item.key}>
                      <Link
                        to={url}
                        onClick={(e) => {
                          if (isModifierClick(e)) return;
                          e.preventDefault();
                          navigate(url);
                        }}
                      >
                        <NavItem
                          active={activeTab === item.key && !activeSubSection}
                          icon={item.icon}
                          title={item.label}
                        />
                      </Link>
                      {item.key === SettingsTabs.Memory && activeTab === item.key && (
                        <MemorySubNav activeSection={activeSubSection} />
                      )}
                    </Fragment>
                  );
                })}
              </Flexbox>
            ),
          }))}
          onValueChange={(keys) => onExpandedGroupsChange(keys as SettingsGroupKey[])}
        />
      </SearchSection>
    </Flexbox>
  );
});

export default Body;
