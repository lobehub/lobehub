'use client';

import { Flexbox, Icon, Markdown, Tooltip } from '@lobehub/ui';
import { Button, Skeleton, Spin, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  BookOpen,
  ChevronRight,
  ExternalLink,
  FileDown,
  FileText,
  type LucideIcon,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useEntityMarkdown } from '@/features/EntityLink';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useChatStore } from '@/store/chat';
import { shinyTextStyles } from '@/styles';

import { coordinatorNodeTitleKey } from './coordinatorCopy';
import { openTargetOf, useOpenGoalArtifact } from './Deliverables';
import type { GoalArtifactView, GoalGraphView, GoalNodeView } from './goalGraphViewModel';
import {
  buildResultTrail,
  buildStoryChapters,
  resultTrailSource,
  type ResultTrailStep,
  type StoryChapterView,
} from './goalResultState';
import { type MainlineEmphasis, nodeEmphasis, resolveMainline } from './Graph/mainline';
import { KIND_COLOR, KIND_ICON } from './shared';

/**
 * 探索过程 — the audit trail under the delivered document.
 *
 * Read top-down, one layer at a time: the document above is the answer; each
 * stage here is a piece of the way there with the conclusions it reached and
 * the files it wrote; a conclusion opens its evidence beside the page.
 *
 * Once the wrap-up agent has written the Goal report, the stages are its
 * chapters — titled, narrated, and honest about the detours taken, each of
 * which opens the chapter's local map beside the page. While that report is
 * being written the section says so; without one (or when the run failed) it
 * falls back to the trail `buildResultTrail` derives per task.
 */

const styles = createStaticStyles(({ css }) => ({
  arrow: css`
    flex: none;
    color: ${cssVar.colorTextQuaternary};
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
  /** Same colour as the mainline on the exploration map, so the two read as one path. */
  stageMainline: css`
    border-color: ${cssVar.colorPrimary};
    color: ${cssVar.colorPrimary};
  `,
  mainlineTag: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorPrimary};
  `,
  stepMuted: css`
    opacity: 0.55;
  `,
  /**
   * Review: the count is a note about the chapter, not a badge — plain gray
   * text, with no tinted fill or pill around it, so it never competes with the
   * chapter title it sits beside.
   */
  detour: css`
    cursor: pointer;

    display: inline-flex;
    flex: none;
    align-items: center;

    /* Reset the native button chrome — the hint is text, not a control. */
    padding: 0;
    border: none;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: none;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  narrative: css`
    color: ${cssVar.colorTextSecondary};
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

/**
 * A conclusion opens beside the page, like every other drill-down here: read
 * inline, a long finding pushed the rest of the trail off screen and left the
 * reader scrolling back to find the stage it belonged to.
 */
const TrailFinding = ({
  onOpen,
  view,
}: {
  onOpen: (nodeId: string) => void;
  view: GoalNodeView;
}) => {
  const { t } = useTranslation('chat');
  const summary = summaryOf(view.node.description);

  return (
    <TrailItem
      icon={KIND_ICON.finding}
      title={view.node.title}
      tone={KIND_COLOR.finding}
      trailing={<Icon className={styles.arrow} icon={ChevronRight} size={14} />}
      subtitle={
        summary ? `${t('goalProcess.kind.finding')} · ${summary}` : t('goalProcess.kind.finding')
      }
      onClick={() => onOpen(view.node.id)}
    />
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

/** One stage of the section: the rail, its number, a header and what it holds. */
const Stage = ({
  children,
  emphasis,
  header,
  index,
  last,
}: {
  children?: ReactNode;
  /** How the stage reads against the report's mainline, as on the exploration map. */
  emphasis?: MainlineEmphasis;
  header: ReactNode;
  index: number;
  last: boolean;
}) => (
  <Flexbox horizontal className={cx(emphasis === 'muted' && styles.stepMuted)} gap={12}>
    <div className={cx(styles.rail, last && styles.railLast)}>
      <span className={cx(styles.stageNumber, emphasis === 'mainline' && styles.stageMainline)}>
        {index + 1}
      </span>
    </div>
    <Flexbox flex={1} gap={10} paddingBlock={'2px 24px'} style={{ minWidth: 0 }}>
      <Flexbox horizontal align={'center'} gap={8} style={{ minHeight: 24 }}>
        {header}
      </Flexbox>
      {children}
    </Flexbox>
  </Flexbox>
);

const TrailStep = ({
  documentId,
  emphasis,
  index,
  last,
  onOpenArtifact,
  onSelect,
  step,
}: {
  documentId?: string;
  emphasis: MainlineEmphasis;
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
    <Stage
      emphasis={emphasis}
      index={index}
      last={last}
      header={
        <>
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
          {emphasis === 'mainline' && (
            <span className={styles.mainlineTag}>{t('goalProcess.graph.legend.mainline')}</span>
          )}
          {view && <StepTime view={view} />}
        </>
      }
    >
      <div className={styles.list}>
        {step.findings.map((finding) => (
          <TrailFinding key={finding.node.id} view={finding} onOpen={onSelect} />
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
    </Stage>
  );
};

const DetourHint = ({
  chapter,
  onOpen,
}: {
  chapter: StoryChapterView['chapter'];
  onOpen: () => void;
}) => {
  const { t } = useTranslation('chat');
  const count = chapter.detours.length;

  return (
    <Tooltip
      title={
        <Flexbox gap={6} style={{ maxWidth: 360 }}>
          {chapter.detours.map((detour, index) => (
            <div key={index}>
              <b>{detour.title}</b>
              {`：${detour.reason}`}
            </div>
          ))}
          <Text fontSize={12} style={{ color: 'inherit', opacity: 0.7 }}>
            {t('goalProcess.result.story.detourOpen')}
          </Text>
        </Flexbox>
      }
    >
      <button className={styles.detour} type={'button'} onClick={onOpen}>
        {t('goalProcess.result.story.detours', { count })}
      </button>
    </Tooltip>
  );
};

const StoryChapter = ({
  documentId,
  goalId,
  last,
  onOpenArtifact,
  onSelect,
  view,
}: {
  documentId?: string;
  goalId: string;
  last: boolean;
  onOpenArtifact: (artifact: GoalArtifactView) => void;
  onSelect: (nodeId: string) => void;
  view: StoryChapterView;
}) => {
  const openChapter = useChatStore((s) => s.openGoalReportChapter);
  const { chapter } = view;
  const markdownProps = useEntityMarkdown();
  const hasItems = view.findings.length > 0 || view.artifacts.length > 0;

  return (
    <Stage
      index={view.index}
      last={last}
      header={
        <>
          <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={600}>
            {chapter.title}
          </Text>
          {chapter.detours.length > 0 && (
            <DetourHint chapter={chapter} onOpen={() => openChapter(goalId, view.index)} />
          )}
        </>
      }
    >
      <Markdown className={styles.narrative} fontSize={14} variant={'chat'} {...markdownProps}>
        {chapter.narrative}
      </Markdown>
      {hasItems && (
        <div className={styles.list}>
          {view.findings.map((finding) => (
            <TrailFinding key={finding.node.id} view={finding} onOpen={onSelect} />
          ))}
          {view.artifacts.map((artifact) => (
            <TrailArtifact
              artifact={artifact}
              isDocument={!!documentId && artifact.resourceId === documentId}
              key={artifact.workVersionId}
              onOpen={onOpenArtifact}
            />
          ))}
        </div>
      )}
    </Stage>
  );
};

/**
 * The wrap-up agent is still writing. Shaped like the chapters that will
 * replace it — rail, number, a title over its narrative — so nothing jumps when
 * the graph poll brings the storyline in.
 */
const TrailPending = () => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={8} role={'status'}>
        <Spin size={'small'} variant={'network'} />
        <Text className={shinyTextStyles.shinyText} weight={500}>
          {t('goalProcess.result.story.pending')}
        </Text>
      </Flexbox>
      <Text fontSize={12} type={'secondary'}>
        {t('goalProcess.result.story.pendingHint')}
      </Text>
      <Flexbox aria-hidden gap={0}>
        {[0, 1].map((index) => (
          <Stage
            header={<Skeleton height={16} radius={4} width={index === 0 ? '36%' : '28%'} />}
            index={index}
            key={index}
            last={index === 1}
          >
            <Flexbox gap={8}>
              <Skeleton height={14} radius={4} />
              <Skeleton height={14} radius={4} width={'72%'} />
            </Flexbox>
          </Stage>
        ))}
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
  const openArtifact = useOpenGoalArtifact();
  const openReport = useChatStore((s) => s.openGoalReport);
  const source = resultTrailSource(graph);
  const title = (
    <Text fontSize={16} weight={600}>
      {t('goalProcess.result.trail.title')}
    </Text>
  );

  if (source.kind === 'pending')
    return (
      <Flexbox gap={16}>
        {title}
        <TrailPending />
      </Flexbox>
    );

  if (source.kind === 'story') {
    const chapters = buildStoryChapters(graph, source.metadata);
    return (
      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          {title}
          {source.report.content?.trim() && (
            <Button
              icon={<Icon icon={BookOpen} />}
              size={'small'}
              onClick={() => openReport(graph.goal.id)}
            >
              {t('goalProcess.result.story.readReport')}
            </Button>
          )}
        </Flexbox>
        <Flexbox gap={0}>
          {chapters.map((chapter, index) => (
            <StoryChapter
              documentId={documentId}
              goalId={graph.goal.id}
              key={index}
              last={index === chapters.length - 1}
              view={chapter}
              onOpenArtifact={openArtifact}
              onSelect={onSelect}
            />
          ))}
        </Flexbox>
      </Flexbox>
    );
  }

  const steps = buildResultTrail(graph);
  if (steps.length === 0) return null;
  // The steps the report's mainline runs through wear the same mark as on the map.
  const mainline = resolveMainline(graph);

  return (
    <Flexbox gap={16}>
      {title}
      <Flexbox gap={0}>
        {steps.map((step, index) => (
          <TrailStep
            documentId={documentId}
            emphasis={step.view ? nodeEmphasis(mainline, step.view.node) : undefined}
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
