'use client';

import { Accordion, AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { Link, useLocation } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import { getTabUrl, SearchSection } from '@/features/SettingsSearch';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { SettingsTabs } from '@/store/global/initialState';
import { isModifierClick } from '@/utils/navigation';

import { SettingsGroupKey, useCategory } from '../../hooks/useCategory';

const Body = memo(() => {
  const categoryGroups = useCategory();
  const navigate = useWorkspaceAwareNavigate();
  const location = useLocation();

  // Extract current tab from pathname: /settings/profile -> profile
  const activeTab = useMemo(() => {
    const pathParts = location.pathname.split('/');
    // pathname is like /settings/profile or /settings/provider/xxx
    if (pathParts.length >= 3) {
      return pathParts[2] as SettingsTabs;
    }
    return SettingsTabs.Profile;
  }, [location.pathname]);

  return (
    <Flexbox gap={4} paddingInline={4}>
      <SearchSection>
        <Accordion
          gap={8}
          defaultExpandedKeys={[
            SettingsGroupKey.General,
            SettingsGroupKey.Subscription,
            SettingsGroupKey.Agent,
            SettingsGroupKey.System,
            SettingsGroupKey.Developer,
          ]}
        >
          {categoryGroups.map((group) => (
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
                  const url = item.href ?? getTabUrl(item.key);
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
            </AccordionItem>
          ))}
        </Accordion>
      </SearchSection>
    </Flexbox>
  );
});

export default Body;
