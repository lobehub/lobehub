'use client';

import { AGENT_SHARE_VISITOR_TOPIC_URL } from '@lobechat/const';
import type { ShareVisitorTopicGroup } from '@lobechat/types';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  AccordionTrigger,
  Flexbox,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { ChevronLeftIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AsyncError from '@/components/AsyncError';
import UserAvatar from '@/components/UserAvatar';
import { buildAgentProfileTabPath } from '@/features/AgentProfileTabs/tabOptions';
import Agent from '@/features/AgentSidebar/Header/Agent';
import NavItem from '@/features/NavPanel/components/NavItem';
import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import ToggleLeftPanelButton from '@/features/NavPanel/ToggleLeftPanelButton';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

import { useActiveVisitorTopic } from './useActiveVisitorTopic';
import { useShareVisitorTopicGroups } from './useShareVisitorTopics';

const COUNT_STYLE = { fontVariantNumeric: 'tabular-nums' } as const;

/** Lines topic titles up under the visitor's name, past the avatar slot. */
const ICON_PLACEHOLDER = <span aria-hidden style={{ flex: 'none', width: 16 }} />;

const VisitorGroup = ({
  activeTopicId,
  agentId,
  group,
}: {
  activeTopicId: string | undefined;
  agentId: string;
  group: ShareVisitorTopicGroup;
}) => {
  const { t } = useTranslation('topic');
  const sectionTriggerStyle = useSectionTriggerStyle();
  const navigate = useWorkspaceAwareNavigate();
  const workspaceSlug = useActiveWorkspaceSlug();
  const name = group.visitor.name || t('management.shareVisitors.unnamedVisitor');

  return (
    <AccordionItem value={group.visitor.id}>
      <AccordionHeader>
        <AccordionTrigger style={sectionTriggerStyle}>
          <Flexbox horizontal align={'center'} gap={6} height={24} style={{ minWidth: 0 }}>
            <UserAvatar
              avatar={group.visitor.avatar}
              name={name}
              shape={'circle'}
              size={16}
              style={{ flex: 'none' }}
            />
            <SectionTitle>{name}</SectionTitle>
            <Text fontSize={11} style={COUNT_STYLE} type={'secondary'}>
              {group.topics.length}
            </Text>
          </Flexbox>
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionPanel contentStyle={{ padding: 0 }}>
        <Flexbox gap={1} paddingBlock={1}>
          {group.topics.map((topic) => {
            const path = AGENT_SHARE_VISITOR_TOPIC_URL(agentId, topic.id);
            return (
              <NavItem
                titleMarquee
                active={topic.id === activeTopicId}
                href={buildWorkspaceAwarePath(path, workspaceSlug)}
                icon={ICON_PLACEHOLDER}
                key={topic.id}
                title={topic.title || topic.preview || t('shareVisitorTopics.untitled')}
                titleColor={cssVar.colorText}
                onClick={() => navigate(path)}
              />
            );
          })}
        </Flexbox>
      </AccordionPanel>
    </AccordionItem>
  );
};

/**
 * Replaces the Agent's topic sidebar on the visitors page: the visitors' run topics through the
 * share link, grouped by visitor, with the way back to the Share settings they were opened from.
 * Every visitor starts expanded; collapsing one is remembered while the page stays open.
 */
const ShareVisitorSidebarNav = () => {
  const { t } = useTranslation('topic');
  const navigate = useWorkspaceAwareNavigate();
  const agentId = useActiveRouteParams().aid!;
  const { error, groups, isLoading, mutate } = useShareVisitorTopicGroups(agentId);
  const { activeTopicId, activeVisitorId } = useActiveVisitorTopic(groups);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [revealedVisitorId, setRevealedVisitorId] = useState<string>();

  // Opening a topic reveals it inside its visitor group, once per visitor so the group can still be
  // collapsed afterwards.
  if (activeVisitorId && activeVisitorId !== revealedVisitorId) {
    setRevealedVisitorId(activeVisitorId);
    if (collapsed.includes(activeVisitorId))
      setCollapsed(collapsed.filter((id) => id !== activeVisitorId));
  }

  const expanded = groups.map((group) => group.visitor.id).filter((id) => !collapsed.includes(id));

  return (
    <SideBarLayout
      body={
        <Flexbox gap={4} paddingInline={4}>
          <Flexbox horizontal align={'center'} gap={4} paddingBlock={4} paddingInline={8}>
            <Text fontSize={12} type={'secondary'} weight={500}>
              {t('shareVisitorTopics.title')}
            </Text>
            {groups.length > 0 && (
              <Text fontSize={11} style={COUNT_STYLE} type={'secondary'}>
                {groups.length}
              </Text>
            )}
          </Flexbox>
          {error && groups.length === 0 ? (
            <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />
          ) : !isLoading && groups.length === 0 ? (
            <Text fontSize={12} style={{ paddingInline: 8 }} type={'secondary'}>
              {t('shareVisitorTopics.empty')}
            </Text>
          ) : (
            <AccordionRoot
              indicatorPlacement="inline"
              style={{ gap: 2 }}
              value={expanded}
              onValueChange={(next) => {
                const open = next as string[];
                setCollapsed(
                  groups.map((group) => group.visitor.id).filter((id) => !open.includes(id)),
                );
              }}
            >
              {groups.map((group) => (
                <VisitorGroup
                  activeTopicId={activeTopicId}
                  agentId={agentId}
                  group={group}
                  key={group.visitor.id}
                />
              ))}
            </AccordionRoot>
          )}
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
              title={t('shareVisitorTopics.backToShare')}
              onClick={() => navigate(buildAgentProfileTabPath(agentId, 'share'))}
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

export default ShareVisitorSidebarNav;
