'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ExternalLink, FileDown, FileText, Link2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isSafeExternalUrl } from '@/features/Work/descriptors';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useChatStore } from '@/store/chat';

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
 *
 * Opening one keeps you on the goal: the surrounding page already drills into a
 * node or a task run through the side Portal, and a deliverable is the same
 * kind of look. Navigating away would cost the reader the goal they were
 * reading. Only a resource that genuinely lives outside the product leaves.
 */

const styles = createStaticStyles(({ css }) => ({
  producer: css`
    flex: none;
    justify-content: flex-end;
    max-width: 40%;
  `,
  /**
   * A fixed slot for the timestamp. Without it the attribution column ends
   * wherever the relative time happens to start, so a list mixing "几秒前" with
   * "8 小时前" loses the very alignment this row is built for.
   */
  time: css`
    flex: none;
    min-width: 60px;
    text-align: end;
  `,
  row: css`
    width: 100%;
    padding-block: 8px;
    padding-inline: 8px;
    border: none;
    border-radius: ${cssVar.borderRadiusSM};

    text-align: start;

    background: none;
  `,
  rowOpenable: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
}));

/**
 * Where a row actually goes, or `undefined` when it goes nowhere: an external
 * Work registered without a url, a file version missing its `fileUrl`, a
 * document whose binding never resolved. Such a row must not look clickable,
 * and a url is only a destination once it is proven http(s) — a stored value
 * can carry `javascript:` / `data:` / a custom scheme, and on desktop
 * `window.open` hands straight to `shell.openExternal`.
 */
export const openTargetOf = (artifact: GoalArtifactView) => {
  if (artifact.type === 'document' && artifact.resourceId) return { kind: 'document' } as const;
  if (isSafeExternalUrl(artifact.url)) return { kind: 'external', url: artifact.url } as const;
  return undefined;
};

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

  const openable = !!openTargetOf(artifact);

  return (
    <Flexbox
      horizontal
      align={'center'}
      as={openable ? 'button' : 'div'}
      className={cx(styles.row, openable && styles.rowOpenable)}
      gap={8}
      // A real button carries focus, Enter/Space and the right semantics for
      // free; a row with nowhere to go stays inert rather than faking an
      // affordance it cannot honour.
      {...(openable ? { onClick: () => onOpen(artifact), type: 'button' as const } : {})}
    >
      <Icon color={cssVar.colorTextQuaternary} icon={icon} size={14} />
      {/* The title takes the slack so the attribution and the timestamp form
          right-aligned columns; letting the title size itself left every row's
          attribution starting at a different x. */}
      <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
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
      <Text className={styles.time} fontSize={12} title={title} type={'secondary'}>
        {text}
      </Text>
    </Flexbox>
  );
});

DeliverableRow.displayName = 'GoalDeliverableRow';

const Deliverables = memo<{ graph: GoalGraphView }>(({ graph }) => {
  const { t } = useTranslation('chat');
  const openDocument = useChatStore((s) => s.openDocument);

  const open = (artifact: GoalArtifactView) => {
    const target = openTargetOf(artifact);
    if (!target) return;
    // `openDocument` takes the DOCUMENT id, not the agent-document binding id:
    // `agentDocumentId` only establishes that a binding exists.
    if (target.kind === 'document') {
      openDocument(artifact.resourceId!, artifact.agentDocumentId);
      return;
    }
    // A generated file and an external resource both leave for their canonical
    // target. The file-preview Portal is not a substitute: it resolves a
    // knowledge-base item, so an ordinary exported file loads forever in it.
    window.open(target.url, '_blank', 'noopener,noreferrer');
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
