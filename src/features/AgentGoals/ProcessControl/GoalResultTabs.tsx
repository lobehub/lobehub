'use client';

import { Flexbox } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import GoalFollowUpComposer from './GoalFollowUpComposer';
import type { GoalGraphView } from './goalGraphViewModel';
import GoalResult from './GoalResult';
import { hasGoalResult } from './goalResultState';

/**
 * A finished Goal opens on what it delivered; how it got there moves to a
 * second tab. A Goal still in flight has no result to hand over, so it keeps
 * the single process view with no tabs at all.
 *
 * Hosts key this by goal id, so switching goals starts back on the result.
 */

type GoalTab = 'process' | 'result';

interface GoalResultTabsProps {
  graph: GoalGraphView;
  /** Hands a question about the result to the goal's conversation; absent hides the composer. */
  onFollowUp?: (message: string) => void;
  onSelect: (nodeId: string) => void;
  /** The 执行过程 content — the whole process view the host already renders. */
  process: ReactNode;
}

const GoalResultTabs = ({ graph, onFollowUp, onSelect, process }: GoalResultTabsProps) => {
  const { t } = useTranslation('chat');
  const [tab, setTab] = useState<GoalTab>('result');

  if (!hasGoalResult(graph)) return <>{process}</>;

  return (
    <Flexbox gap={20}>
      <Tabs
        activeKey={tab}
        style={{ marginInline: -6 }}
        variant={'square'}
        items={[
          { key: 'result', label: t('goalProcess.tabs.result') },
          { key: 'process', label: t('goalProcess.tabs.process') },
        ]}
        onChange={(key) => setTab(key as GoalTab)}
      />
      {/* Only the active tab mounts: the exploration map measures its box on
          mount and would lay out against a hidden panel. */}
      {tab === 'result' ? <GoalResult graph={graph} onSelect={onSelect} /> : process}
      {/* Kept mounted across tabs so a half-written follow-up survives a look
          at the process; it only shows under the result. */}
      {onFollowUp && <GoalFollowUpComposer hidden={tab !== 'result'} onSend={onFollowUp} />}
    </Flexbox>
  );
};

export default GoalResultTabs;
