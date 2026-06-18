'use client';

import { Accordion, AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { DEFAULT_WORKSPACE_SETTINGS_TAB, WorkspaceSettingsTabs } from '@/types/workspaceSettings';
import { isModifierClick } from '@/utils/navigation';

import { useWorkspaceSettingCategory, WorkspaceSettingsGroupKey } from '../hooks/useCategory';

const Body = memo(() => {
  const navigate = useWorkspaceAwareNavigate();
  const location = useLocation();
  const slug = useActiveWorkspaceSlug();
  const groups = useWorkspaceSettingCategory();

  const activeTab = useMemo(() => {
    if (!slug) return DEFAULT_WORKSPACE_SETTINGS_TAB;
    const parts = location.pathname.split('/').filter(Boolean);
    const tab = parts[2];
    return tab && (Object.values(WorkspaceSettingsTabs) as string[]).includes(tab)
      ? (tab as WorkspaceSettingsTabs)
      : DEFAULT_WORKSPACE_SETTINGS_TAB;
  }, [location.pathname, slug]);

  if (!slug) return null;

  return (
    <Flexbox paddingInline={4}>
      <Accordion
        gap={8}
        defaultExpandedKeys={[
          WorkspaceSettingsGroupKey.General,
          WorkspaceSettingsGroupKey.Subscription,
          WorkspaceSettingsGroupKey.Agent,
          WorkspaceSettingsGroupKey.Admin,
        ]}
      >
        {groups.map((group) => (
          <AccordionItem
            itemKey={group.key}
            key={group.key}
            paddingBlock={4}
            paddingInline={'8px 4px'}
            title={
              <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                {group.title}
              </Text>
            }
          >
            <Flexbox gap={1} paddingBlock={1}>
              {group.items.map((item) => {
                const url = `/${slug}/settings/${item.key}`;
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
                    <NavItem active={activeTab === item.key} icon={item.icon} title={item.label} />
                  </Link>
                );
              })}
            </Flexbox>
          </AccordionItem>
        ))}
      </Accordion>
    </Flexbox>
  );
});

export default Body;
