'use client';

import { Flexbox, Tabs, Tag } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { dedupeArtifacts } from './deliverableList';
import Deliverables from './Deliverables';
import Findings from './Findings';
import type { GoalGraphView } from './goalGraphViewModel';

/**
 * 交付物 and 结论 are two views of the same output — the artifacts the goal
 * produced, and what it now believes about them — so they share one block
 * instead of two stacked sections. It opens on the deliverables: the thing you
 * can open comes before the prose about it.
 *
 * 决策 is deliberately not a third tab: it is where a person stepped into the
 * run, not something the run produced.
 */

type DeliveryTab = 'deliverables' | 'findings';

interface DeliveryTabsProps {
  graph: GoalGraphView;
  onSelect: (nodeId: string) => void;
}

const DeliveryTabs = memo<DeliveryTabsProps>(({ graph, onSelect }) => {
  const { t } = useTranslation('chat');
  const [tab, setTab] = useState<DeliveryTab>('deliverables');

  // Same fold the list applies, so the count never exceeds the rows below it.
  const deliverableCount = dedupeArtifacts(graph.artifacts).length;
  const findingCount = graph.findings.length;

  const label = (text: string, count: number) => (
    <Flexbox horizontal align={'center'} gap={8}>
      {text}
      {count > 0 && <Tag size={'small'}>{count}</Tag>}
    </Flexbox>
  );

  return (
    <Flexbox gap={8}>
      <Tabs
        activeKey={tab}
        style={{ marginInline: -6 }}
        variant={'square'}
        items={[
          {
            key: 'deliverables',
            label: label(t('goalProcess.deliverables.title'), deliverableCount),
          },
          { key: 'findings', label: label(t('goalProcess.findings.title'), findingCount) },
        ]}
        onChange={(key) => setTab(key as DeliveryTab)}
      />
      {tab === 'deliverables' && <Deliverables graph={graph} />}
      {tab === 'findings' && <Findings graph={graph} onSelect={onSelect} />}
    </Flexbox>
  );
});

DeliveryTabs.displayName = 'GoalDeliveryTabs';

export default DeliveryTabs;
