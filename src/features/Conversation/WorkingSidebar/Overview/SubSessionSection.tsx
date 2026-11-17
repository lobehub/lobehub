'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SubSessionNode } from '@/features/AgentSidebar/Topic/SubSession/buildSubSessionTree';
import SubSessionItem from '@/features/AgentSidebar/Topic/SubSession/SubSessionItem';
import { useChatStore } from '@/store/chat';
import { subSessionSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { sectionStyles } from './sectionStyles';

/**
 * The conversations this one opened (Better Coding Experience), beside its
 * sub-agents: each with its state, opening on its own agent's route.
 */
const SubSessionSection = memo<{ agentId?: string; topicId: string }>(({ agentId, topicId }) => {
  const { t } = useTranslation('topic');
  const enabled = useUserStore(labPreferSelectors.enableBetterCodingExperience);
  const openers = useMemo(() => [topicId], [topicId]);
  const useFetchSubSessions = useChatStore((s) => s.useFetchSubSessions);
  useFetchSubSessions(enabled, openers);
  const nodes = useChatStore(subSessionSelectors.treeOf(openers), isEqual) as SubSessionNode[];

  if (!enabled || nodes.length === 0) return null;

  return (
    <Flexbox className={sectionStyles.section} data-testid="overview-sub-sessions">
      <Flexbox className={sectionStyles.sectionHeader}>
        <span className={sectionStyles.sectionTitle}>
          {t('subSession.sectionTitle', { count: nodes.length })}
        </span>
      </Flexbox>
      <Flexbox gap={1}>
        {nodes.map((node) => (
          <SubSessionItem key={node.id} node={node} openerAgentId={agentId} />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

SubSessionSection.displayName = 'SubSessionSection';

export default SubSessionSection;
