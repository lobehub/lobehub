'use client';

import { Accordion, AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { SettingsTabs } from '@/store/global/initialState';

import { SettingsGroupKey, useCategory } from '../../hooks/useCategory';

const Body = memo(() => {
  const categoryGroups = useCategory();
  const navigate = useNavigate();
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

  const handleTabClick = (tab: SettingsTabs) => {
    if (tab === SettingsTabs.Provider) {
      navigate('/settings/provider/all');
    } else {
      navigate(`/settings/${tab}`);
    }
  };

  return (
    <Flexbox paddingInline={4}>
      <Accordion
        gap={8}
        defaultExpandedKeys={[
          SettingsGroupKey.Profile,
          SettingsGroupKey.Subscription,
          SettingsGroupKey.Account,
          SettingsGroupKey.AIConfig,
          SettingsGroupKey.System,
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
              {group.items.map((item) => (
                <NavItem
                  active={activeTab === item.key}
                  icon={item.icon}
                  key={item.key}
                  title={item.label}
                  onClick={() => handleTabClick(item.key)}
                />
              ))}
            </Flexbox>
          </AccordionItem>
        ))}
      </Accordion>
    </Flexbox>
  );
});

export default Body;
