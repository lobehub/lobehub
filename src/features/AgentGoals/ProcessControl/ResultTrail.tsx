'use client';

import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronRight, ExternalLink, FileDown, FileText, type LucideIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivityTime } from '@/hooks/useActivityTime';

import { coordinatorNodeTitleKey } from './coordinatorCopy';
import { openTargetOf, useOpenArtifact } from './Deliverables';
import type { GoalArtifactView, GoalGraphView, GoalNodeView } from './goalGraphViewModel';
import { buildResultTrail, type ResultTrailStep } from './goalResultState';
import { KIND_COLOR, KIND_ICON } from './shared';

/**
 * 探索过程 — the audit trail under the delivered document.
 *
 * Read top-down, one layer at a time: the document above is the answer; each
 * step here is a piece of work with the conclusions it reached and the files it
 * wrote; a conclusion expands into its evidence, and the step's title opens the
 * run itself. See `buildResultTrail` for why the two are joined per task.
 */

const styles = createStaticStyles(({ css }) => ({
  arrow: css`
    flex: none;
    color: ${cssVar.colorTextQuaternary};
    transition: transform 0.2s;
  `,
  arrowOpen: css`
    transform: rotate(90deg);
  `,
  /** Aligned with the item title: tile (32) + gap (12) + row padding (12). */
  evidence: css`
    padding-block: 0 12px;
    padding-inline: 56px 12px;
  `,
  /** One stage's outputs, framed as a single list like the frontier's. */
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};

    /* Outranks the row's own "border: none", which would otherwise erase it. */
    & > :not(:first-child) {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  row: css`
    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: none;

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
  /** The rail ties the numbered stages into one sequence. */
  rail: css`
    position: relative;
    flex: none;
    width: 24px;

    &::after {
      content: '';

      position: absolute;
      inset-block: 30px 0;
      inset-inline-start: 11px;

      width: 1px;

      background: ${cssVar.colorBorderSecondary};
    }
  `,
  railLast: css`
    &::after {
      display: none;
    }
  `,
  stageNumber: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 50%;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  stageTitle: css`
    cursor: pointer;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  tile: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${cssVar.borderRadius};
  `,
  time: css`
    flex: none;
    min-width: 60px;
    text-align: end;
  `,
}));

/** First line of a finding's evidence, as the item's one-line summary. */
const summaryOf = (description?: string | null) =>
  description
    ?.split('\n')
    .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
    .find(Boolean);

const TrailItem = ({
  icon,
  meta,
  onClick,
  subtitle,
  title,
  tone,
  trailing,
}: {
  icon: LucideIcon;
  meta?: ReactNode;
  onClick?: () => void;
  subtitle?: ReactNode;
  title: ReactNode;
  tone: { line: string; soft: string };
  trailing?: ReactNode;
}) => (
  <Flexbox
    horizontal
    align={'center'}
    as={onClick ? 'button' : 'div'}
    className={cx(styles.row, onClick && styles.rowOpenable)}
    gap={12}
    {...(onClick ? { onClick, type: 'button' as const } : {})}
  >
    <span className={styles.tile} style={{ background: tone.soft }}>
      <Icon color={tone.line} icon={icon} size={16} />
    </span>
    <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
      <Text ellipsis weight={500}>
        {title}
      </Text>
      {subtitle && (
        <Text ellipsis fontSize={12} type={'secondary'}>
          {subtitle}
        </Text>
      )}
    </Flexbox>
    {meta}
    {trailing}
  </Flexbox>
);

const TrailFinding = ({ view }: { view: GoalNodeView }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const description = view.node.description;
  const summary = summaryOf(description);

  return (
    <div>
      <TrailItem
        icon={KIND_ICON.finding}
        title={view.node.title}
        tone={KIND_COLOR.finding}
        // Expanded, the evidence below already says what the summary said.
        subtitle={
          open
            ? undefined
            : summary
              ? `${t('goalProcess.kind.finding')} · ${summary}`
              : t('goalProcess.kind.finding')
        }
        trailing={
          description ? (
            <Icon
              className={cx(styles.arrow, open && styles.arrowOpen)}
              icon={ChevronRight}
              size={14}
            />
          ) : undefined
        }
        onClick={description ? () => setOpen(!open) : undefined}
      />
      {open && description && (
        <div className={styles.evidence}>
          <Markdown fontSize={13} variant={'chat'}>
            {description}
          </Markdown>
        </div>
      )}
    </div>
  );
};

const ARTIFACT_TONE = { line: cssVar.colorTextSecondary, soft: cssVar.colorFillTertiary };

const TrailArtifact = ({
  artifact,
  isDocument,
  onOpen,
}: {
  artifact: GoalArtifactView;
  /** The document already shown in full above — pointed at, not reopened. */
  isDocument: boolean;
  onOpen: (artifact: GoalArtifactView) => void;
}) => {
  const { t } = useTranslation('chat');
  const { text, title } = useActivityTime(artifact.createdAt);
  const openable = !isDocument && !!openTargetOf(artifact);
  const icon =
    artifact.type === 'document' ? FileText : artifact.type === 'file' ? FileDown : ExternalLink;

  return (
    <TrailItem
      icon={icon}
      title={artifact.title || artifact.identifier || t('goalProcess.deliverables.untitled')}
      tone={ARTIFACT_TONE}
      meta={
        <Text className={styles.time} fontSize={12} title={title} type={'secondary'}>
          {text}
        </Text>
      }
      subtitle={
        isDocument
          ? `${t('goalProcess.deliverables.title')} · ${t('goalProcess.result.trail.shownAbove')}`
          : t('goalProcess.deliverables.title')
      }
      onClick={openable ? () => onOpen(artifact) : undefined}
    />
  );
};

const StepTime = ({ view }: { view: GoalNodeView }) => {
  const { text, title } = useActivityTime(view.node.resolvedAt ?? view.node.updatedAt);
  return (
    <Text className={styles.time} fontSize={12} title={title} type={'secondary'}>
      {text}
    </Text>
  );
};

const TrailStep = ({
  documentId,
  index,
  last,
  onOpenArtifact,
  onSelect,
  step,
}: {
  documentId?: string;
  index: number;
  last: boolean;
  onOpenArtifact: (artifact: GoalArtifactView) => void;
  onSelect: (nodeId: string) => void;
  step: ResultTrailStep;
}) => {
  const { t } = useTranslation('chat');
  const { view } = step;
  const titleKey = view ? coordinatorNodeTitleKey(view) : undefined;
  const title = view
    ? titleKey
      ? t(titleKey as any)
      : view.node.title
    : t('goalProcess.result.trail.unattributed');

  return (
    <Flexbox horizontal gap={12}>
      <div className={cx(styles.rail, last && styles.railLast)}>
        <span className={styles.stageNumber}>{index + 1}</span>
      </div>
      <Flexbox flex={1} gap={10} paddingBlock={'2px 24px'} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8} style={{ minHeight: 24 }}>
          {view ? (
            // The run itself is the deepest layer: open it for the full account.
            <Text
              ellipsis
              className={styles.stageTitle}
              style={{ flex: 1, minWidth: 0 }}
              weight={600}
              onClick={() => onSelect(view.node.id)}
            >
              {title}
            </Text>
          ) : (
            <Text style={{ flex: 1, minWidth: 0 }} type={'secondary'} weight={600}>
              {title}
            </Text>
          )}
          {view && <StepTime view={view} />}
        </Flexbox>
        <div className={styles.list}>
          {step.findings.map((finding) => (
            <TrailFinding key={finding.node.id} view={finding} />
          ))}
          {step.artifacts.map((artifact) => (
            <TrailArtifact
              artifact={artifact}
              isDocument={!!documentId && artifact.resourceId === documentId}
              key={artifact.workVersionId}
              onOpen={onOpenArtifact}
            />
          ))}
        </div>
      </Flexbox>
    </Flexbox>
  );
};

interface ResultTrailProps {
  /** The delivered document already rendered above the trail. */
  documentId?: string;
  graph: GoalGraphView;
  onSelect: (nodeId: string) => void;
}

const ResultTrail = ({ documentId, graph, onSelect }: ResultTrailProps) => {
  const { t } = useTranslation('chat');
  const openArtifact = useOpenArtifact();
  const steps = buildResultTrail(graph);

  if (steps.length === 0) return null;

  return (
    <Flexbox gap={16}>
      <Text fontSize={16} weight={600}>
        {t('goalProcess.result.trail.title')}
      </Text>
      <Flexbox gap={0}>
        {steps.map((step, index) => (
          <TrailStep
            documentId={documentId}
            index={index}
            key={step.key}
            last={index === steps.length - 1}
            step={step}
            onOpenArtifact={openArtifact}
            onSelect={onSelect}
          />
        ))}
      </Flexbox>
    </Flexbox>
  );
};

export default ResultTrail;
