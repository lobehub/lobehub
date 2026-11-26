'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { Fragment, memo, useMemo } from 'react';
import { Link } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import { SearchSection } from '@/features/SettingsSearch';
import { useSettingsScopeTitle } from '@/features/SettingsSwitch/useSettingsScopeTitle';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { SettingsTabs } from '@/store/global/initialState';
import { isModifierClick } from '@/utils/navigation';

import { SettingsGroupKey } from '../../hooks/useCategory';
import { useExpandedSettingsGroups } from '../../hooks/useExpandedSettingsGroups';
import { usePersonalSettingsScope } from '../../hooks/usePersonalSettingsScope';
import { usePersonalSettingsSearchScope } from '../../hooks/useSettingsSearchScope';
import MemorySubNav from '../../memory/MemorySubNav';

const PERSONAL_SPACE = { kind: 'personal' } as const;

const Body = memo(() => {
  const sectionTriggerStyle = useSectionTriggerStyle();
  const { activeTab, categoryGroups, scopeGroups, tabUrl } = usePersonalSettingsScope();
  const accountTitle = useSettingsScopeTitle('account', PERSONAL_SPACE);
  const spaceTitle = useSettingsScopeTitle('space', PERSONAL_SPACE);
  // Search covers both sets; each result names the set it lives in, and
  // opening it switches the sidebar to that set.
  const searchGroups = useMemo(
    () =>
      categoryGroups.map((group) => ({
        ...group,
        title: `${group.scope === 'account' ? accountTitle : spaceTitle} › ${group.title}`,
      })),
    [categoryGroups, accountTitle, spaceTitle],
  );
  const searchScope = usePersonalSettingsSearchScope(searchGroups);
  const navigate = useWorkspaceAwareNavigate();
  const location = useActiveLocation();

  // Only Memory lists its sub-pages here; other tabs keep their row active on `:sub`.
  const activeSubSection =
    activeTab === SettingsTabs.Memory ? location.pathname.split('/')[3] : undefined;

  const { expandedGroups, onExpandedGroupsChange } = useExpandedSettingsGroups(
    scopeGroups,
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
          items={scopeGroups.map((group) => ({
            key: group.key,
            title: <SectionTitle>{group.title}</SectionTitle>,
            children: (
              <Flexbox gap={1} paddingBlock={1}>
                {group.items.map((item) => {
                  const url = tabUrl(item.key);
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
