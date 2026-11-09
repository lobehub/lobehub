'use client';

import { Flexbox } from '@lobehub/ui';
import type { LucideIcon } from 'lucide-react';
import {
  ChartColumnBigIcon,
  ChevronLeftIcon,
  FileUserIcon,
  RadioTowerIcon,
  Share2Icon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import {
  type AgentProfileTab,
  buildAgentProfileTabPath,
} from '@/features/AgentProfileTabs/tabOptions';
import { useAgentProfileTabOptions } from '@/features/AgentProfileTabs/useAgentProfileTabOptions';
import NavItem from '@/features/NavPanel/components/NavItem';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

import Agent from './Header/Agent';

const TAB_ICONS: Record<AgentProfileTab, LucideIcon> = {
  channel: RadioTowerIcon,
  profile: FileUserIcon,
  share: Share2Icon,
  statistics: ChartColumnBigIcon,
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
        <Flexbox gap={1} paddingInline={4}>
          {options.map(({ label, value }) => (
            <NavItem
              active={value === active}
              icon={TAB_ICONS[value]}
              key={value}
              title={label}
              onClick={() => navigate(buildAgentProfileTabPath(agentId, value))}
            />
          ))}
        </Flexbox>
      }
      header={
        <>
          <SideBarHeaderLayout
            showBack={false}
            left={
              <NavItem
                icon={ChevronLeftIcon}
                title={t('tab.backToChat')}
                onClick={() => navigate(urlJoin('/agent', agentId))}
              />
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
