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
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import UserAvatar from '@/components/UserAvatar';
import NavItem from '@/features/NavPanel/components/NavItem';
import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

import { useShareVisitorTopics } from './useShareVisitorTopics';

const COUNT_STYLE = { fontVariantNumeric: 'tabular-nums' } as const;

/** Lines topic titles up with the Agent's own topic rows, which lead with a status icon slot. */
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

const VISITOR_TOPIC_PATH = /\/visitor\/([^/]+)\/?$/;

interface ShareVisitorTopicsSectionProps {
  agentId: string;
  itemKey: string;
}

/**
 * Visitors' conversations with the Agent through its share link, as run topics grouped by visitor.
 * Shown only while the share lets the owner read them; each topic opens read-only.
 */
const ShareVisitorTopicsSection = ({ agentId, itemKey }: ShareVisitorTopicsSectionProps) => {
  const { t } = useTranslation('topic');
  const sectionTriggerStyle = useSectionTriggerStyle();
  const groups = useShareVisitorTopics(agentId);
  const { pathname } = useLocation();
  const activeTopicId = VISITOR_TOPIC_PATH.exec(pathname)?.[1];
  const activeVisitorId = useMemo(
    () =>
      activeTopicId
        ? groups.find((group) => group.topics.some((topic) => topic.id === activeTopicId))?.visitor
            .id
        : undefined,
    [activeTopicId, groups],
  );
  const [expanded, setExpanded] = useState<string[]>([]);
  const [revealedVisitorId, setRevealedVisitorId] = useState<string>();

  // Opening a topic from elsewhere (the Topics page) reveals it in its visitor's group, once per
  // visitor so the group can still be collapsed afterwards.
  if (activeVisitorId && activeVisitorId !== revealedVisitorId) {
    setRevealedVisitorId(activeVisitorId);
    if (!expanded.includes(activeVisitorId)) setExpanded([...expanded, activeVisitorId]);
  }

  if (groups.length === 0) return null;

  return (
    <AccordionItem value={itemKey}>
      <AccordionHeader>
        <AccordionTrigger style={sectionTriggerStyle}>
          <Flexbox horizontal align="center" gap={4}>
            <SectionTitle>{t('shareVisitorTopics.title')}</SectionTitle>
            <Text fontSize={11} style={COUNT_STYLE} type="secondary">
              {groups.length}
            </Text>
          </Flexbox>
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionPanel contentStyle={{ padding: 0 }}>
        <AccordionRoot
          indicatorPlacement="inline"
          style={{ gap: 2 }}
          value={expanded}
          onValueChange={(next) => setExpanded(next as string[])}
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
      </AccordionPanel>
    </AccordionItem>
  );
};

export default ShareVisitorTopicsSection;
