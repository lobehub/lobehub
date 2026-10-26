'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { agentDisplayName, type SidebarAgentItem } from '@lobechat/types';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  AccordionTrigger,
  ActionIcon,
  DropdownMenu,
  Flexbox,
  Text,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { UserRoundPlusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import Avatar from '@/components/Avatar';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import { AgentModalProvider } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import { useCreateMenuItems } from '@/features/HomeSidebar/hooks';
import { AVATAR_SIZE, ConversationRow, ListHeader } from '@/features/MessageList';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import { NAV_PANEL_CONTACTS_KEY } from '@/features/NavPanel/railRouteKey';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { styles } from './style';

const byTitle = (fallback: string) => (a: SidebarAgentItem, b: SidebarAgentItem) =>
  agentDisplayName(a, fallback).localeCompare(agentDisplayName(b, fallback), 'zh-Hans-CN');

const useActiveRouteId = () => {
  const { pathname } = useActiveLocation();
  const slug = useActiveWorkspaceSlug();
  const segments = pathname.split('/').filter(Boolean);
  const [root, id] = slug && segments[0] === slug ? segments.slice(1) : segments;

  return root === 'agent' || root === 'group' ? id : undefined;
};

const Contact = memo<{ active: boolean; item: SidebarAgentItem }>(({ active, item }) => {
  const { t } = useTranslation('chat');
  const isGroup = item.type === 'group';
  const title = isGroup
    ? item.title || t('untitledAgent')
    : agentDisplayName(item, t('untitledAgent'));
  const customAvatar = typeof item.avatar === 'string' ? item.avatar : undefined;

  return (
    <ConversationRow
      active={active}
      preview={item.description || undefined}
      title={title}
      url={isGroup ? `/group/${item.id}/profile` : `/agent/${item.id}/profile`}
      avatar={
        isGroup ? (
          <AgentGroupAvatar
            avatar={customAvatar}
            backgroundColor={item.backgroundColor || undefined}
            memberAvatars={Array.isArray(item.avatar) ? item.avatar : []}
            size={AVATAR_SIZE}
          />
        ) : (
          <Avatar
            emojiScaleWithBackground
            avatar={customAvatar || DEFAULT_AVATAR}
            background={item.backgroundColor || undefined}
            name={title}
            shape={'square'}
            size={AVATAR_SIZE}
          />
        )
      }
    />
  );
});

Contact.displayName = 'Contact';

const Body = memo(() => {
  const { t } = useTranslation('common');
  const { t: tChat } = useTranslation('chat');
  useFetchAgentList();
  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const items = useHomeStore(homeAgentListSelectors.allAgents, isEqual);
  const activeRouteId = useActiveRouteId();

  const { agents, groups } = useMemo(() => {
    const unique = [...new Map(items.map((item) => [item.id, item])).values()];
    const sort = byTitle(tChat('untitledAgent'));
    return {
      agents: unique.filter((item) => item.type !== 'group').sort(sort),
      groups: unique.filter((item) => item.type === 'group').sort(sort),
    };
  }, [items, tChat]);

  if (!isInit && items.length === 0) return <SkeletonList paddingBlock={8} />;

  const sections = [
    // Groups first: there are few, and they would sink below every agent.
    { items: groups, key: 'groups', title: t('contacts.groups') },
    { items: agents, key: 'agents', title: t('navPanel.agent') },
  ];

  // The standard sidebar accordion (same as the home sidebar sections), so
  // each section collapses independently with the shared header styling.
  return (
    <Flexbox paddingBlock={'4px 12px'} paddingInline={4}>
      <AccordionRoot
        defaultValue={sections.map((section) => section.key)}
        indicatorPlacement={'inline'}
        style={{ gap: 8 }}
      >
        {sections.map((section) => (
          <AccordionItem key={section.key} value={section.key}>
            <AccordionHeader>
              <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
                <Flexbox horizontal align={'center'} gap={4}>
                  <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                    {section.title}
                  </Text>
                  <Text fontSize={11} type={'secondary'}>
                    {section.items.length}
                  </Text>
                </Flexbox>
              </AccordionTrigger>
            </AccordionHeader>
            <AccordionPanel>
              <Flexbox gap={1} paddingBlock={1} paddingInline={2}>
                {section.items.length === 0 ? (
                  <div {...stylex.props(styles.empty)}>{t('contacts.empty')}</div>
                ) : (
                  section.items.map((item) => (
                    <Contact active={item.id === activeRouteId} item={item} key={item.id} />
                  ))
                )}
              </Flexbox>
            </AccordionPanel>
          </AccordionItem>
        ))}
      </AccordionRoot>
    </Flexbox>
  );
});

Body.displayName = 'ContactListBody';

const Header = memo(() => {
  const { t } = useTranslation('common');
  const { createTopLevelMenuItems, isLoading } = useCreateMenuItems();
  const createItems = useMemo(() => createTopLevelMenuItems(), [createTopLevelMenuItems]);

  return (
    <ListHeader
      title={t('tab.contacts')}
      actions={
        <DropdownMenu items={createItems}>
          <ActionIcon
            icon={UserRoundPlusIcon}
            loading={isLoading}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('contacts.create')}
          />
        </DropdownMenu>
      }
    />
  );
});

Header.displayName = 'ContactListHeader';

/**
 * Contacts tab list column: every agent and group, alphabetically. A row opens
 * the profile (`/agent/:id/profile`), which is the agent's edit surface.
 */
const ContactListPortal = () => (
  <NavPanelPortal navKey={NAV_PANEL_CONTACTS_KEY}>
    <AgentModalProvider>
      <SideBarLayout body={<Body />} header={<Header />} />
    </AgentModalProvider>
  </NavPanelPortal>
);

export default ContactListPortal;
