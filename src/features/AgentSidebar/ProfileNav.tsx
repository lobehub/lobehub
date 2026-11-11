'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import type { LucideIcon } from 'lucide-react';
import {
  ChartColumnBigIcon,
  ChevronLeftIcon,
  DnaIcon,
  MailIcon,
  RadioTowerIcon,
  Share2Icon,
  UserRoundIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import {
  type AgentProfileTab,
  buildAgentProfileTabPath,
  groupAgentProfileTabOptions,
} from '@/features/AgentProfileTabs/tabOptions';
import { useAgentProfileTabOptions } from '@/features/AgentProfileTabs/useAgentProfileTabOptions';
import NavItem from '@/features/NavPanel/components/NavItem';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

import Agent from './Header/Agent';

const TAB_ICONS: Record<AgentProfileTab, LucideIcon> = {
  'channel': RadioTowerIcon,
  'mail': MailIcon,
  'profile': UserRoundIcon,
  'self-evolving': DnaIcon,
  'share': Share2Icon,
  'statistics': ChartColumnBigIcon,
};

interface ProfileNavProps {
  active: AgentProfileTab;
}

/** Replaces the topic sidebar while the agent's profile group is open. */
const ProfileNav = ({ active }: ProfileNavProps) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const agentId = useActiveRouteParams().aid!;
  const options = useAgentProfileTabOptions(active, agentId);

  return (
    <SideBarLayout
      body={
        <Flexbox gap={12} paddingInline={4}>
          {groupAgentProfileTabOptions(options).map((group) => (
            <Flexbox gap={1} key={group.key}>
              {group.key === 'identity' && (
                <Text
                  ellipsis
                  fontSize={12}
                  style={{ paddingBlock: 4, paddingInline: 8 }}
                  type={'secondary'}
                  weight={500}
                >
                  {t('tab.group.identity')}
                </Text>
              )}
              {group.options.map(({ label, value }) => (
                <NavItem
                  active={value === active}
                  icon={TAB_ICONS[value]}
                  key={value}
                  title={label}
                  onClick={() => navigate(buildAgentProfileTabPath(agentId, value))}
                />
              ))}
            </Flexbox>
          ))}
        </Flexbox>
      }
      header={
        <>
          <SideBarHeaderLayout
            showBack={false}
            left={
              <Button
                icon={ChevronLeftIcon}
                size={'small'}
                type={'text'}
                onClick={() => navigate(urlJoin('/agent', agentId))}
              >
                {t('tab.backToChat')}
              </Button>
            }
          />
          <Flexbox paddingBlock={'0 8px'} paddingInline={6}>
            <Agent />
          </Flexbox>
        </>
      }
    />
  );
};

export default ProfileNav;
