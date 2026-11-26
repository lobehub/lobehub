'use client';

import { Flexbox, Text } from '@lobehub/ui';
import type { LucideIcon } from 'lucide-react';
import {
  ChartColumnBigIcon,
  ChevronLeftIcon,
  CpuIcon,
  DnaIcon,
  GitBranchIcon,
  LibraryBigIcon,
  MailIcon,
  MessageSquareHeartIcon,
  MonitorSmartphoneIcon,
  RadioTowerIcon,
  ScrollTextIcon,
  Share2Icon,
  SparklesIcon,
  UserRoundIcon,
  UsersIcon,
  WebhookIcon,
  WrenchIcon,
  ZapIcon,
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
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import ToggleLeftPanelButton from '@/features/NavPanel/ToggleLeftPanelButton';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

import Agent from './Header/Agent';

const TAB_ICONS: Record<AgentProfileTab, LucideIcon> = {
  'automations': ZapIcon,
  'channel': RadioTowerIcon,
  'engine': CpuIcon,
  'environment': MonitorSmartphoneIcon,
  'graph': GitBranchIcon,
  'instruction': ScrollTextIcon,
  'knowledge': LibraryBigIcon,
  'mail': MailIcon,
  'opening': MessageSquareHeartIcon,
  'permission': UsersIcon,
  'profile': UserRoundIcon,
  'self-evolving': DnaIcon,
  'share': Share2Icon,
  'skills': SparklesIcon,
  'statistics': ChartColumnBigIcon,
  'tools': WrenchIcon,
  'webhook': WebhookIcon,
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
              {group.key !== 'general' && group.key !== 'profile' && (
                <Text
                  ellipsis
                  fontSize={12}
                  style={{ paddingBlock: 4, paddingInline: 8 }}
                  type={'secondary'}
                  weight={500}
                >
                  {t(`tab.group.${group.key}`)}
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
          <Flexbox horizontal align={'center'} paddingBlock={8} paddingInline={4}>
            <NavItem
              as={'button'}
              flex={1}
              icon={ChevronLeftIcon}
              style={{ textAlign: 'start' }}
              title={t('tab.backToChat')}
              onClick={() => navigate(urlJoin('/agent', agentId))}
            />
            <ToggleLeftPanelButton />
          </Flexbox>
          <Flexbox paddingBlock={'0 8px'} paddingInline={6}>
            <Agent />
          </Flexbox>
        </>
      }
    />
  );
};

export default ProfileNav;
