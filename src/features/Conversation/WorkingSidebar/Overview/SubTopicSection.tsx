'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isInFlight,
  type SubTopicNode,
} from '@/features/AgentSidebar/Topic/SubTopic/buildSubTopicTree';
import SubTopicRows from '@/features/AgentSidebar/Topic/SubTopic/SubTopicRows';
import { useChatStore } from '@/store/chat';
import { subTopicSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { sectionProps, sectionStyles } from './sectionStyles';

/**
 * The conversations this one opened (Better Coding Experience), beside its
 * sub-agents: each with its state, opening on its own agent's route.
 */
interface SubTopicSectionProps {
  /** Follows a non-section sibling (the empty-workspace state): see `sectionProps`. */
  afterBreak?: boolean;
  agentId?: string;
  topicId: string;
}

const SubTopicSection = memo<SubTopicSectionProps>(({ afterBreak, agentId, topicId }) => {
  const { t } = useTranslation('topic');
  const enabled = useUserStore(labPreferSelectors.enableBetterCodingExperience);
  const openers = useMemo(() => [topicId], [topicId]);
  const useFetchSubTopics = useChatStore((s) => s.useFetchSubTopics);
  const nodes = useChatStore(subTopicSelectors.treeOf(openers), isEqual) as SubTopicNode[];
  useFetchSubTopics(enabled, openers, nodes.some(isInFlight));

  if (!enabled || nodes.length === 0) return null;

  return (
    <Flexbox {...sectionProps(afterBreak)} data-testid="overview-sub-topics">
      <Flexbox {...stylex.props(sectionStyles.sectionHeader)}>
        <span {...stylex.props(sectionStyles.sectionTitle)}>
          {t('subTopic.sectionTitle', { count: nodes.length })}
        </span>
      </Flexbox>
      <Flexbox gap={1}>
        <SubTopicRows nodes={nodes} openerAgentId={agentId} />
      </Flexbox>
    </Flexbox>
  );
});

SubTopicSection.displayName = 'SubTopicSection';

export default SubTopicSection;
