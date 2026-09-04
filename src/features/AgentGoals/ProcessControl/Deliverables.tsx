'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ExternalLink, FileDown, FileText, Link2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useActivityTime } from '@/hooks/useActivityTime';

import type { GoalArtifactView, GoalGraphView } from './goalGraphViewModel';
import { KindDot } from './shared';

/**
 * What the goal produced, as things you can open.
 *
 * Findings say what the goal now believes; this says what came out of it. They
 * are deliberately separate rows: a finding is the synthesized prose, the
 * deliverable is the artifact that prose is about, and until now the artifact
 * survived only as a URL buried inside that prose.
 *
 * Only artifacts the run persisted into the product appear. Anything a task
 * left on a local path is invisible here by construction — which is what the
 * empty state says, and what the dispatched task contract asks for up front.
 *
 * Goal-level rather than per-task, because "show me the report" is a question
 * about the goal — no single task node can answer it.
 */

const styles = createStaticStyles(({ css }) => ({
  producer: css`
    flex: none;
    max-width: 40%;
  `,
  row: css`
    cursor: pointer;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

const DeliverableRow = memo<{
  artifact: GoalArtifactView;
  onOpen: (artifact: GoalArtifactView) => void;
  producerTitle?: string;
}>(({ artifact, onOpen, producerTitle }) => {
  const { t } = useTranslation('chat');
  const { text, title } = useActivityTime(artifact.createdAt);
  // A document opens inside the app; a generated file downloads; an external
  // resource leaves for its own site.
  const icon =
    artifact.type === 'document' ? FileText : artifact.type === 'file' ? FileDown : ExternalLink;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.row}
      gap={8}
      onClick={() => onOpen(artifact)}
    >
      <Icon color={cssVar.colorTextQuaternary} icon={icon} size={14} />
      <Text ellipsis style={{ flexShrink: 1, minWidth: 0 }} weight={500}>
        {artifact.title || artifact.identifier || t('goalProcess.deliverables.untitled')}
      </Text>
      {!!producerTitle && (
        <Flexbox horizontal align={'center'} className={styles.producer} gap={6}>
          <KindDot kind={'task'} />
          <Text ellipsis fontSize={12} type={'secondary'}>
            {t('goalProcess.deliverables.from', { title: producerTitle })}
          </Text>
        </Flexbox>
      )}
      <Text
        fontSize={12}
        style={{ flex: 'none', marginInlineStart: 'auto' }}
        title={title}
        type={'secondary'}
      >
        {text}
      </Text>
    </Flexbox>
  );
});

DeliverableRow.displayName = 'GoalDeliverableRow';

const Deliverables = memo<{ graph: GoalGraphView }>(({ graph }) => {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const agentId = graph.goal.agentId;

  const open = (artifact: GoalArtifactView) => {
    // A document lives in this app, so keep it in-app; anything else only has
    // the canonical url the producing tool recorded.
    if (artifact.agentDocumentId && agentId) {
      navigate(`/agent/${agentId}/docs/${artifact.agentDocumentId}`);
      return;
    }
    if (artifact.url) window.open(artifact.url, '_blank', 'noopener,noreferrer');
  };

  if (graph.artifacts.length === 0)
    return (
      <Flexbox horizontal align={'center'} gap={6}>
        <Icon color={cssVar.colorTextQuaternary} icon={Link2} size={14} />
        <Text fontSize={13} type={'secondary'}>
          {t('goalProcess.deliverables.empty')}
        </Text>
      </Flexbox>
    );

  return (
    <Flexbox gap={0}>
      {graph.artifacts.map((artifact) => (
        <DeliverableRow
          artifact={artifact}
          key={artifact.workVersionId}
          producerTitle={graph.byId[artifact.nodeId]?.node.title}
          onOpen={open}
        />
      ))}
    </Flexbox>
  );
});

Deliverables.displayName = 'GoalDeliverables';

export default Deliverables;
