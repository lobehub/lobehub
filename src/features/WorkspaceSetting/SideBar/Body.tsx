'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { Link } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import { useExpandedSettingsGroups } from '@/features/Settings/hooks/useExpandedSettingsGroups';
import { SearchSection } from '@/features/SettingsSearch';
import { useSettingsScopeTitle } from '@/features/SettingsSwitch/useSettingsScopeTitle';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { isModifierClick } from '@/utils/navigation';

import { WorkspaceSettingsGroupKey } from '../hooks/useCategory';
import { useWorkspaceSettingsSearchScope } from '../hooks/useSettingsSearchScope';
import { useWorkspaceSettingsScope } from '../hooks/useWorkspaceSettingsScope';

const Body = memo(() => {
  const sectionTriggerStyle = useSectionTriggerStyle();
  const navigate = useWorkspaceAwareNavigate();
  const { activeTab, groups, scopeGroups, slug, space, tabUrl } = useWorkspaceSettingsScope();
  const accountTitle = useSettingsScopeTitle('account', space);
  const spaceTitle = useSettingsScopeTitle('space', space);
  // Search covers both sets; each result names the set it lives in, and
  // opening it switches the sidebar to that set.
  const searchGroups = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        title: `${group.scope === 'account' ? accountTitle : spaceTitle} › ${group.title}`,
      })),
    [groups, accountTitle, spaceTitle],
  );
  const searchScope = useWorkspaceSettingsSearchScope(slug, searchGroups);

  const { expandedGroups, onExpandedGroupsChange } = useExpandedSettingsGroups(
    scopeGroups,
    activeTab,
    WorkspaceSettingsGroupKey.System,
  );

  if (!slug) return null;

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
                  const url = item.href ?? tabUrl(item.key);
                  return (
                    <Link
                      key={item.key}
                      to={url}
                      onClick={(e) => {
                        if (isModifierClick(e)) return;
                        e.preventDefault();
                        // Already a full path: a workspace tab carries its
                        // slug, a personal-only account tab must not get one.
                        navigate(url, { escape: true });
                      }}
                    >
                      <NavItem
                        active={!item.href && activeTab === item.key}
                        icon={item.icon}
                        title={item.label}
                      />
                    </Link>
                  );
                })}
              </Flexbox>
            ),
          }))}
          onValueChange={(keys) => onExpandedGroupsChange(keys as WorkspaceSettingsGroupKey[])}
        />
      </SearchSection>
    </Flexbox>
  );
});

export default Body;
