'use client';

import { Accordion, Flexbox, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { Link } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import NavItem from '@/features/NavPanel/components/NavItem';
import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import { useExpandedSettingsGroups } from '@/features/Settings/hooks/useExpandedSettingsGroups';
import { SearchSection } from '@/features/SettingsSearch';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { DEFAULT_WORKSPACE_SETTINGS_TAB, WorkspaceSettingsTabs } from '@/types/workspaceSettings';
import { isModifierClick } from '@/utils/navigation';

import { useWorkspaceSettingCategory, WorkspaceSettingsGroupKey } from '../hooks/useCategory';
import {
  getWorkspaceSettingsTabUrl,
  useWorkspaceSettingsSearchScope,
} from '../hooks/useSettingsSearchScope';

const Body = memo(() => {
  const sectionTriggerStyle = useSectionTriggerStyle();
  const navigate = useWorkspaceAwareNavigate();
  const location = useActiveLocation();
  const slug = useActiveWorkspaceSlug();
  const groups = useWorkspaceSettingCategory();
  const searchScope = useWorkspaceSettingsSearchScope(slug, groups);

  const activeTab = useMemo(() => {
    if (!slug) return DEFAULT_WORKSPACE_SETTINGS_TAB;
    const parts = location.pathname.split('/').filter(Boolean);
    const tab = parts[2];
    return tab && (Object.values(WorkspaceSettingsTabs) as string[]).includes(tab)
      ? (tab as WorkspaceSettingsTabs)
      : DEFAULT_WORKSPACE_SETTINGS_TAB;
  }, [location.pathname, slug]);

  const { expandedGroups, onExpandedGroupsChange } = useExpandedSettingsGroups(
    groups,
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
          items={groups.map((group) => ({
            key: group.key,
            title: <SectionTitle>{group.title}</SectionTitle>,
            children: (
              <Flexbox gap={1} paddingBlock={1}>
                {group.items.map((item) => {
                  const url = getWorkspaceSettingsTabUrl(slug, item.key);
                  return (
                    <Link
                      key={item.key}
                      to={url}
                      onClick={(e) => {
                        if (isModifierClick(e)) return;
                        e.preventDefault();
                        navigate(url);
                      }}
                    >
                      <NavItem
                        active={activeTab === item.key}
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
