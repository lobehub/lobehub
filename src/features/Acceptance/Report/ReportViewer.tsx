'use client';

import type {
  VerifyAgentPlanConfig,
  VerifyCheckItem,
  VerifyCodingScope,
  VerifyRunOrigin,
  VerifySurface,
  VerifyVerdict,
} from '@lobechat/types';
import { Block, Button, Center, Empty, Flexbox, Icon, Image, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  AudioLines,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDashed,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileText,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Globe,
  Image as ImageIcon,
  MessagesSquare,
  Monitor,
  RefreshCw,
  Smartphone,
  Terminal,
  Video,
  X,
} from 'lucide-react';
import { memo, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import AudioPlayer from '@/features/AudioPlayer';
import type { VerifyEvidenceWithUrl } from '@/services/verify';
import { sx } from '@/styles/sx';

import { AcceptanceDrawer } from '../AcceptanceDrawer';
import { useVerifyReportBundle } from '../hooks';
import {
  buildCheckRows,
  type CheckRowData,
  type CheckState,
  extractUuid,
  renderableSurfaces,
} from '../utils';
import {
  EvidenceComparisonCard,
  isFilenameLike,
  meaningfulEvidenceCaption,
} from './EvidenceComparisonCard';
import InteractionCostPanel, { readInteractionCost } from './InteractionCost';
import {
  CollapsibleMarkdownEvidence,
  DocumentViewer,
  markdownTextEvidenceTypes,
  rendersAsMarkdown,
} from './MarkdownEvidence';
import { originTopicHref } from './originLink';
import summaryStyles from './ReportViewer.module.css';
import {
  type EvidenceCategory,
  evidenceCategory,
  evidenceComparison,
  evidenceDisplayName,
  imageEvidenceTypes,
  isInlineEvidence,
  isInlineVisualEvidence,
  isTerminalEvidence,
} from './ReportViewer/model';
import { TerminalEvidenceCard } from './TerminalEvidence';
import { readVisualizationManifest } from './visualization';
import { VisualizationRenderer } from './VisualizationRenderer';

const styles = stylex.create({
  scroll: { overflow: 'auto', width: '100%', height: '100%' },
  page: {
    width: '100%',
    maxWidth: '880px',
    marginInline: 'auto',
    paddingBlockStart: { 'default': '32px', '@media (width <= 767px)': '16px' },
    paddingBlockEnd: {
      'default': '64px',
      '@media (width <= 767px)': 'calc(24px + env(safe-area-inset-bottom))',
    },
    /* Start-aligned with the 46px gutter a check row's body sits at, so the hero
       prose and the expanded check prose share one text edge. */
    paddingInlineStart: { 'default': '46px', '@media (width <= 767px)': '16px' },
    paddingInlineEnd: { 'default': '32px', '@media (width <= 767px)': '16px' },
    overflowWrap: { 'default': null, '@media (width <= 767px)': 'anywhere' },
  },

  /* hero */
  heroLine: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    alignItems: 'center',
  },
  pill: {
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    paddingBlock: '5px',
    paddingInline: '13px',
    borderRadius: '999px',
    fontSize: '13px',
    fontWeight: 600,
    lineHeight: 1,
  },
  summary: { maxWidth: '100%', lineHeight: 1.6, color: cssVar.colorText },
  liveBanner: {
    display: 'inline-flex',
    gap: '8px',
    alignItems: 'center',
    width: 'fit-content',
    marginBlockStart: '4px',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorInfoBorder,
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorInfoText,
    backgroundColor: cssVar.colorInfoBg,
    backgroundImage: 'none',
  },
  /* Provenance: where the code came from. Reference material the reader scans,
     so it stays visually subordinate to the verdict + summary above it. */
  codingScope: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: '0',
    maxWidth: '100%',
    marginBlockStart: '4px',
  },
  /* The PR gets its own line. It is the one outbound link a reader actually
     follows, and its title is long enough that sharing a row with branch/commit
     would either push them onto a second line anyway or truncate the title to
     nothing. */
  scopePullRequestLine: { display: 'flex', minWidth: '0', maxWidth: '100%' },
  scopeMetaLine: {
    display: 'flex',
    flexWrap: 'wrap',
    rowGap: '6px',
    columnGap: '14px',
    alignItems: 'center',
    minWidth: '0',
    maxWidth: '100%',
  },
  /* Icons and <code> inside the provenance chips: StyleX has no descendant
     selectors, so each element carries its own rule. */
  chipIcon: {
    flexGrow: '0',
    flexShrink: '0',
    flexBasis: 'auto',
    color: cssVar.colorTextQuaternary,
  },
  chipCode: {
    overflow: 'hidden',
    minWidth: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  commitCode: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  branchChip: {
    display: 'inline-flex',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    maxWidth: 'min(360px, 100%)',
    color: cssVar.colorTextTertiary,
  },
  commitChip: {
    display: 'inline-flex',
    flexGrow: '0',
    flexShrink: '0',
    flexBasis: 'auto',
    gap: '6px',
    alignItems: 'center',
    color: cssVar.colorTextTertiary,
  },
  /* Resting: number secondary, title tertiary, icon quaternary — a quiet chip.
     Hover lifts the WHOLE thing to the primary text color at once (a clearly
     perceptible emphasis, not a one-gray-step nudge), and never the global
     link-blue. Vars so number/title/icon rise together. */
  prChip: {
    '--pr-number-color': cssVar.colorTextSecondary,
    '--pr-title-color': cssVar.colorTextTertiary,
    '--pr-icon-color': cssVar.colorTextQuaternary,
    'cursor': 'default',
    'display': 'inline-flex',
    'flexGrow': '0',
    'flexShrink': '1',
    'flexBasis': 'auto',
    'gap': '6px',
    'alignItems': 'center',
    /* Owns its own line, so the title gets the full column before ellipsizing. */
    'minWidth': '0',
    'maxWidth': '100%',
    'fontSize': '12px',
    'color': 'var(--pr-number-color)',
    'textDecoration': 'none',
    'transition': 'color 0.15s',
  },
  /* `data-link` chips: the hover step re-asserts the color over the global
     `a:hover` link-blue — the chip's hover is a text-emphasis step, never a recolor. */
  prChipLink: {
    '--pr-number-color': {
      'default': cssVar.colorTextSecondary,
      ':hover': cssVar.colorText,
    },
    '--pr-title-color': {
      'default': cssVar.colorTextTertiary,
      ':hover': cssVar.colorText,
    },
    '--pr-icon-color': {
      'default': cssVar.colorTextQuaternary,
      ':hover': cssVar.colorTextSecondary,
    },
    'cursor': 'pointer',
    'color': { 'default': 'var(--pr-number-color)', ':hover': 'var(--pr-number-color)' },
  },
  prIcon: {
    flexGrow: '0',
    flexShrink: '0',
    flexBasis: 'auto',
    color: 'var(--pr-icon-color)',
    transition: 'color 0.15s',
  },
  prNumber: {
    flexGrow: '0',
    flexShrink: '0',
    flexBasis: 'auto',
    color: 'var(--pr-number-color)',
    transition: 'color 0.15s',
  },
  prTitle: {
    overflow: 'hidden',
    flexGrow: '1',
    flexShrink: '1',
    flexBasis: 'auto',
    minWidth: '0',
    color: 'var(--pr-title-color)',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    transition: 'color 0.15s',
  },
  scopeMetaItem: {
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    maxWidth: '100%',
    fontSize: '12px',
    lineHeight: 1.45,
    color: cssVar.colorTextTertiary,
  },
  /* The command / URL under test. Can be long; it must never push the rest of
     the provenance line onto a second row. */
  scopeEntry: { maxWidth: '260px' },
  originLink: {
    cursor: 'pointer',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorLink },
    textDecoration: 'none',
  },
  originLinkIcon: {
    flexGrow: '0',
    flexShrink: '0',
    flexBasis: 'auto',
    color: {
      default: cssVar.colorTextQuaternary,
      [stylex.when.ancestor(':hover')]: cssVar.colorLink,
    },
  },
  surfaceList: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  surfaceChip: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  surfaceIcon: { color: cssVar.colorTextTertiary },

  /* checks */
  /* The filter bar used to carry this gap in its own margin; without it the
     hero and the first row collided. */
  checks: {
    overflow: 'hidden',
    marginBlockStart: '24px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  row: {
    borderBlockEndWidth: { 'default': null, ':not(:last-child)': '1px' },
    borderBlockEndStyle: { 'default': null, ':not(:last-child)': 'solid' },
    borderBlockEndColor: { 'default': null, ':not(:last-child)': cssVar.colorBorderSecondary },
  },
  rowHead: {
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: {
      'default': '20px minmax(0, 1fr) auto',
      '@media (width <= 767px)': '20px minmax(0, 1fr)',
    },
    rowGap: { 'default': '10px', '@media (width <= 767px)': '6px' },
    columnGap: { 'default': '10px', '@media (width <= 767px)': '8px' },
    alignItems: 'center',
    width: '100%',
    paddingBlock: { 'default': '11px', '@media (width <= 767px)': '12px' },
    paddingInline: { 'default': '16px', '@media (width <= 767px)': '12px' },
    borderStyle: 'none',
    textAlign: 'start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillQuaternary },
    backgroundImage: 'none',
  },
  rowTitle: {
    overflow: 'hidden',
    fontSize: '14px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: { 'default': 'nowrap', '@media (width <= 767px)': 'normal' },
    overflowWrap: { 'default': null, '@media (width <= 767px)': 'anywhere' },
  },
  rowTitleFailed: { fontWeight: 600 },
  rowSide: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    gridColumn: { 'default': null, '@media (width <= 767px)': 2 },
    flexWrap: { 'default': null, '@media (width <= 767px)': 'wrap' },
  },
  softTag: {
    paddingBlock: '1px',
    paddingInline: '7px',
    borderRadius: '4px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  chev: { color: cssVar.colorTextQuaternary, transition: 'transform 0.15s ease' },
  chevOpen: { transform: 'rotate(90deg)' },
  rowBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    paddingBlockStart: '2px',
    paddingBlockEnd: '16px',
    paddingInlineStart: { 'default': '46px', '@media (width <= 767px)': '12px' },
    paddingInlineEnd: { 'default': '16px', '@media (width <= 767px)': '12px' },
  },
  reasoning: { fontSize: '13px', lineHeight: 1.6, color: cssVar.colorTextSecondary },
  suggestion: {
    paddingInlineStart: '10px',
    borderInlineStartWidth: '2px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorder,
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
  },
  /* What the run said it would do, before it did it — read above the outcome so
     intent and result sit together and a gap between them is visible. */
  planDetail: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'auto minmax(0, 1fr)',
      '@media (width <= 767px)': 'minmax(0, 1fr)',
    },
    rowGap: '4px',
    columnGap: { 'default': '8px', '@media (width <= 767px)': '4px' },
    fontSize: '13px',
    lineHeight: 1.6,
    color: {
      'default': cssVar.colorTextTertiary,
      '@media (width <= 767px)': cssVar.colorTextSecondary,
    },
  },
  planDetailLabel: { color: cssVar.colorTextQuaternary, whiteSpace: 'nowrap' },
  notExecutedHint: { fontSize: '13px', lineHeight: 1.6, color: cssVar.colorTextTertiary },

  /* narrative */
  narrative: { marginBlockStart: '24px' },
  /* A closed <details> shows only its summary; the marker on <details> lets the
     body hide itself exactly as the old `:not([open]) > :not(summary)` did. */
  narrativeContent: {
    display: { default: null, [stylex.when.ancestor(':not([open])')]: 'none' },
  },
  narrativeSummary: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    listStyle: 'none',
  },
  narrativeBody: {
    marginBlockStart: '12px',
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  interactionCostBody: { marginBlockStart: '12px' },

  /* evidence */
  evidenceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    alignItems: 'flex-start',
    width: '100%',
  },
  evidenceFile: {
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: '18px minmax(0, 1fr)',
    gap: '8px',
    alignItems: 'center',
    width: 'min(100%, 520px)',
    paddingBlock: '7px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorLink },
    borderRadius: cssVar.borderRadius,
    color: { 'default': null, ':hover': cssVar.colorLink },
    textAlign: 'start',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  evidenceFileIcon: { display: 'flex', color: cssVar.colorTextTertiary },
  evidenceFileBody: { display: 'flex', flexDirection: 'column', minWidth: '0' },
  evidenceFileName: {
    overflow: 'hidden',
    fontSize: '13px',
    lineHeight: 1.35,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  evidenceFileDesc: {
    overflow: 'hidden',
    marginBlockStart: '2px',
    fontSize: '12px',
    lineHeight: 1.35,
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  evidenceText: {
    overflow: 'auto',
    maxHeight: '200px',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  evidenceVideo: {
    alignSelf: 'flex-start',
    width: 'auto',
    maxWidth: '100%',
    maxHeight: '360px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    objectFit: 'contain',
  },
  evChip: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '999px',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  evidenceDoc: {
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    width: '100%',
    minHeight: '0',
  },
});

const VERDICT_META: Record<
  CheckState,
  { bg: string; color: string; dot: string; icon: typeof Check; labelKey: string }
> = {
  failed: {
    bg: cssVar.colorErrorBg,
    color: cssVar.colorErrorText,
    dot: cssVar.colorError,
    icon: X,
    labelKey: 'report.verdict.failed',
  },
  not_executed: {
    bg: cssVar.colorFillTertiary,
    color: cssVar.colorTextTertiary,
    dot: cssVar.colorTextQuaternary,
    icon: CircleDashed,
    labelKey: 'report.verdict.notExecuted',
  },
  passed: {
    bg: cssVar.colorSuccessBg,
    color: cssVar.colorSuccessText,
    dot: cssVar.colorSuccess,
    icon: Check,
    labelKey: 'report.verdict.passed',
  },
  uncertain: {
    bg: cssVar.colorWarningBg,
    color: cssVar.colorWarningText,
    dot: cssVar.colorWarning,
    icon: CircleHelp,
    labelKey: 'report.verdict.uncertain',
  },
};

/** Each surface reads as a badge, so it needs a mark, not just a word. */
const SURFACE_ICON: Record<VerifySurface, typeof Check> = {
  bot: Bot,
  cli: Terminal,
  desktop: Monitor,
  mobile: Smartphone,
  web: Globe,
};

const CATEGORY_ICON: Record<EvidenceCategory, typeof FileText> = {
  audio: AudioLines,
  file: FileText,
  image: ImageIcon,
  video: Video,
};
const CATEGORY_ORDER: EvidenceCategory[] = ['image', 'video', 'audio', 'file'];
// `errored` is terminal too (the verifier couldn't run) — stop polling and don't
// treat it as a live/in-progress status.
const terminalRunStatuses = new Set(['delivered', 'errored', 'failed', 'passed']);
const liveStatusLabelKey = {
  planned: 'report.status.planned',
  repairing: 'report.status.repairing',
  unverified: 'report.status.unverified',
  verifying: 'report.status.verifying',
} as const;

/** One evidence artifact rendered by its type: zoomable image/gif, video, doc, text. */
const EvidenceItem = memo<{
  evidence: VerifyEvidenceWithUrl;
  /** Inside a comparison card: the card frames the media, so no own border/radius/captions. */
  flat?: boolean;
  index: number;
}>(({ evidence: e, flat, index }) => {
  const { t } = useTranslation('verify');
  const label = evidenceDisplayName(e, t, index);
  const description = meaningfulEvidenceCaption(e.description, label);
  // Inline media (image/gif/video) speaks for itself — the raw filename header
  // is visual noise, so only keep a meaningful caption (description) for it.
  const isMedia = isInlineVisualEvidence(e);
  const isTerminal = isTerminalEvidence(e);
  const isDocument = Boolean(e.fileUrl) && !isMedia && e.type !== 'audio' && !isTerminal;
  const isInlineProse = Boolean(e.content) && markdownTextEvidenceTypes.has(e.type);
  const hideLabel =
    isTerminal ||
    isDocument ||
    isMedia ||
    (markdownTextEvidenceTypes.has(e.type) && isFilenameLike(label)) ||
    isInlineProse;

  return (
    <Flexbox gap={6} style={isDocument ? { flex: 1, minHeight: 0 } : undefined}>
      {!hideLabel && (
        <Text strong fontSize={13}>
          {label}
        </Text>
      )}
      {description && !flat && !isInlineProse && !isTerminal && (
        // Inline prose is excluded: its authored description becomes the fold
        // row's title below, so a standalone line here would say it twice.
        <Text fontSize={13} type={'secondary'}>
          {description}
        </Text>
      )}
      {isTerminal ? (
        // The card titles itself with the command and shows the description under it.
        <TerminalEvidenceCard defaultExpanded={flat} evidence={e} />
      ) : e.fileUrl && imageEvidenceTypes.has(e.type) ? (
        <Flexbox align={flat ? undefined : 'flex-start'} style={{ maxWidth: '100%' }}>
          <Image
            preview
            alt={e.description ?? label}
            src={e.fileUrl}
            variant={flat ? 'borderless' : 'outlined'}
            style={
              flat ? { borderRadius: 0, maxWidth: '100%', width: '100%' } : { maxWidth: '100%' }
            }
          />
        </Flexbox>
      ) : e.fileUrl && e.type === 'video' ? (
        <video controls {...stylex.props(styles.evidenceVideo)} src={e.fileUrl} />
      ) : e.fileUrl && e.type === 'audio' ? (
        // The same waveform player the conversation renders — one audio dialect
        // across the product, plus the download the reviewer needs to keep the
        // deliverable.
        <AudioPlayer
          fullWidth
          alt={e.description ?? label}
          downloadFileName={e.fileName ?? 'audio'}
          url={e.fileUrl}
        />
      ) : e.fileUrl ? (
        <div {...stylex.props(styles.evidenceDoc)}>
          <DocumentViewer fileName={e.fileName} markdown={rendersAsMarkdown(e)} url={e.fileUrl} />
        </div>
      ) : e.content && markdownTextEvidenceTypes.has(e.type) ? (
        // Same dialect as the acceptance viewer: an authored alt/description
        // becomes the fold row's title, not a supplement line below it. The
        // raw description, not the caption filter — with no fileName the label
        // IS the description, and the filter would null it out.
        <CollapsibleMarkdownEvidence
          fileName={e.fileName}
          markdown={rendersAsMarkdown(e)}
          title={e.description?.trim() || e.fileName?.trim() || undefined}
        >
          {e.content}
        </CollapsibleMarkdownEvidence>
      ) : e.content ? (
        <div {...stylex.props(styles.evidenceText)}>{e.content}</div>
      ) : (
        <span {...stylex.props(styles.softTag)}>{e.type}</span>
      )}
    </Flexbox>
  );
});

const EvidenceFileButton = memo<{
  evidence: VerifyEvidenceWithUrl;
  index: number;
  onClick: () => void;
}>(({ evidence, index, onClick }) => {
  const { t } = useTranslation('verify');
  const name = evidenceDisplayName(evidence, t, index);
  const description =
    evidence.description && evidence.description !== name ? evidence.description : null;

  return (
    <button
      {...stylex.props(styles.evidenceFile)}
      title={t('report.evidence.openDetail', { name })}
      type={'button'}
      onClick={onClick}
    >
      <span {...stylex.props(styles.evidenceFileIcon)}>
        <Icon icon={CATEGORY_ICON[evidenceCategory(evidence.type)]} size={13} />
      </span>
      <span {...stylex.props(styles.evidenceFileBody)}>
        <span {...stylex.props(styles.evidenceFileName)}>{name}</span>
        {description && <span {...stylex.props(styles.evidenceFileDesc)}>{description}</span>}
      </span>
    </button>
  );
});

EvidenceFileButton.displayName = 'EvidenceFileButton';

/** Right-side evidence gallery — one section per artifact, by type. */
const EvidenceDrawer = memo<{
  evidence: VerifyEvidenceWithUrl[];
  onClose: () => void;
  open: boolean;
  title: string;
}>(({ evidence, onClose, open, title }) => (
  <AcceptanceDrawer
    containerMaxWidth={'100%'}
    open={open}
    placement={'right'}
    title={title}
    width={'min(1120px, calc(100vw - 48px))'}
    styles={{
      bodyContent: {
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        padding: 0,
      },
    }}
    onClose={onClose}
  >
    <Flexbox
      gap={20}
      height={'100%'}
      paddingBlock={12}
      paddingInline={16}
      style={{ overflow: 'auto' }}
    >
      {evidence.map((e, index) => (
        <EvidenceItem evidence={e} index={index + 1} key={e.id} />
      ))}
    </Flexbox>
  </AcceptanceDrawer>
));

EvidenceItem.displayName = 'EvidenceItem';

const EvidenceComparisonView = memo<{
  after: VerifyEvidenceWithUrl;
  before: VerifyEvidenceWithUrl;
}>(({ after, before }) => {
  // Either half may carry the layout; the `before` one wins so a pair can't
  // render as two different arrangements.
  const layout = evidenceComparison(before)?.layout ?? evidenceComparison(after)?.layout;

  // The band caption: an authored label wins; the evidence's own description is
  // the natural fallback so a pair never renders as two bare role words — but a
  // default filename description is noise, not a caption.
  const side = (evidence: VerifyEvidenceWithUrl, index: number) => ({
    caption:
      evidenceComparison(evidence)?.label ??
      (isFilenameLike(evidence.description) ? undefined : (evidence.description ?? undefined)),
    content: <EvidenceItem flat evidence={evidence} index={index} />,
  });

  return <EvidenceComparisonCard after={side(after, 2)} before={side(before, 1)} layout={layout} />;
});

EvidenceComparisonView.displayName = 'EvidenceComparisonView';

EvidenceDrawer.displayName = 'EvidenceDrawer';

/** One check — an expandable row; evidence opens one artifact at a time. */
const CheckRow = memo<{ defaultOpen: boolean; row: CheckRowData }>(({ defaultOpen, row }) => {
  const { t } = useTranslation('verify');
  const { planItem, result, state } = row;
  const [open, setOpen] = useState(defaultOpen);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const meta = VERDICT_META[state];
  const evidence = result?.evidence ?? [];
  const evidenceCount = evidence.length;
  const visualization = readVisualizationManifest(result?.metadata);
  // An agent-authored plan item records how it meant to check this and what it
  // expected to see (prose), plus the evidence media it is required to produce
  // (a closed set the executor's coverage gate enforces).
  const planConfig = (planItem?.verifierConfig ?? {}) as VerifyAgentPlanConfig;
  const requiredEvidence = planConfig.requiredEvidence ?? [];
  const categoryCounts = evidence.reduce(
    (acc, e) => {
      acc[evidenceCategory(e.type)] += 1;
      return acc;
    },
    { audio: 0, file: 0, image: 0, video: 0 } as Record<EvidenceCategory, number>,
  );
  // `required` lives on the result when there is one, on the plan item otherwise
  // — a check that never ran still knows whether it was optional.
  const required = result?.required ?? planItem?.required ?? true;
  const hasBody =
    Boolean(result?.toulmin?.evidence) ||
    Boolean(result?.suggestion) ||
    Boolean(visualization) ||
    Boolean(planConfig.method) ||
    Boolean(planConfig.expected) ||
    requiredEvidence.length > 0 ||
    state === 'not_executed' ||
    evidenceCount > 0;
  const selectedEvidenceIndex = selectedEvidenceId
    ? evidence.findIndex((e) => e.id === selectedEvidenceId)
    : -1;
  const selectedEvidence = selectedEvidenceIndex >= 0 ? evidence[selectedEvidenceIndex] : null;
  const comparisonGroups = new Map<
    string,
    Partial<Record<'after' | 'before', VerifyEvidenceWithUrl>>
  >();
  for (const item of evidence) {
    const comparison = evidenceComparison(item);
    if (!comparison) continue;
    const group = comparisonGroups.get(comparison.id) ?? {};
    group[comparison.role] = item;
    comparisonGroups.set(comparison.id, group);
  }
  const pairedEvidenceIds = new Set(
    [...comparisonGroups.values()]
      .filter((group) => group.before && group.after)
      .flatMap((group) => [group.before!.id, group.after!.id]),
  );

  return (
    <div {...stylex.props(styles.row)}>
      <button
        aria-expanded={hasBody ? open : undefined}
        {...stylex.props(styles.rowHead)}
        type={'button'}
        onClick={() => hasBody && setOpen((o) => !o)}
      >
        <span style={{ color: meta.dot, display: 'flex' }}>
          <Icon icon={meta.icon} size={16} />
        </span>
        <span
          {...stylex.props(styles.rowTitle, state === 'failed' && styles.rowTitleFailed)}
          data-failed={state === 'failed'}
        >
          {result?.checkItemTitle || planItem?.title || row.id}
        </span>
        <span {...stylex.props(styles.rowSide)}>
          {CATEGORY_ORDER.map((cat) =>
            categoryCounts[cat] > 0 ? (
              <span
                {...stylex.props(styles.evChip)}
                key={cat}
                title={`${t(`report.evidence.category.${cat}`)} × ${categoryCounts[cat]}`}
              >
                <Icon icon={CATEGORY_ICON[cat]} size={12} />
                {categoryCounts[cat]}
              </span>
            ) : null,
          )}
          {state === 'not_executed' && (
            <span {...stylex.props(styles.softTag)}>{t('report.verdict.notExecuted')}</span>
          )}
          {!required && <span {...stylex.props(styles.softTag)}>{t('report.check.optional')}</span>}
          {hasBody && (
            <Icon
              className={stylex.props(styles.chev, open && styles.chevOpen).className}
              data-open={open}
              icon={ChevronRight}
              size={14}
            />
          )}
        </span>
      </button>
      {open && hasBody && (
        <div {...stylex.props(styles.rowBody)}>
          {(planConfig.method || planConfig.expected || requiredEvidence.length > 0) && (
            <div {...stylex.props(styles.planDetail)}>
              {planConfig.method && (
                <>
                  <span {...stylex.props(styles.planDetailLabel)}>{t('report.plan.method')}</span>
                  <span>{planConfig.method}</span>
                </>
              )}
              {planConfig.expected && (
                <>
                  <span {...stylex.props(styles.planDetailLabel)}>{t('report.plan.expected')}</span>
                  <span>{planConfig.expected}</span>
                </>
              )}
              {/* The media this item is *required* to produce. Not decoration: a
                  missing one fails the item through the executor's coverage gate,
                  so a reader can see what the check was contractually owed. */}
              {requiredEvidence.length > 0 && (
                <>
                  <span {...stylex.props(styles.planDetailLabel)}>
                    {t('report.plan.requiredEvidence')}
                  </span>
                  <span {...stylex.props(styles.surfaceList)}>
                    {requiredEvidence.map((spec) => (
                      <span {...stylex.props(styles.surfaceChip)} key={spec.type} title={spec.hint}>
                        <Icon
                          className={stylex.props(styles.surfaceIcon).className}
                          icon={CATEGORY_ICON[evidenceCategory(spec.type)]}
                          size={12}
                        />
                        {t(`report.evidence.medium.${spec.type}`)}
                        {/* Says why an authored example or a bare log leaves it uncovered. */}
                        {spec.provenance === 'execution' &&
                          ` · ${t('report.plan.requiredEvidenceExecution')}`}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </div>
          )}
          {state === 'not_executed' && (
            <p {...stylex.props(styles.notExecutedHint)}>{t('report.plan.notExecutedHint')}</p>
          )}
          {result?.toulmin?.evidence && (
            <p {...stylex.props(styles.reasoning)}>{result.toulmin.evidence}</p>
          )}
          {result?.suggestion && <p {...stylex.props(styles.suggestion)}>{result.suggestion}</p>}
          {visualization && <VisualizationRenderer manifest={visualization} />}
          {evidenceCount > 0 && (
            <>
              <div {...stylex.props(styles.evidenceList)}>
                {[...comparisonGroups.entries()].map(([id, group]) =>
                  group.before && group.after ? (
                    <EvidenceComparisonView after={group.after} before={group.before} key={id} />
                  ) : null,
                )}
                {evidence.map((e, index) =>
                  pairedEvidenceIds.has(e.id) ? null : isInlineEvidence(e) ? (
                    <EvidenceItem evidence={e} index={index + 1} key={e.id} />
                  ) : (
                    <EvidenceFileButton
                      evidence={e}
                      index={index + 1}
                      key={e.id}
                      onClick={() => setSelectedEvidenceId(e.id)}
                    />
                  ),
                )}
              </div>
              {selectedEvidence && (
                <EvidenceDrawer
                  evidence={[selectedEvidence]}
                  open={Boolean(selectedEvidence)}
                  title={evidenceDisplayName(selectedEvidence, t, selectedEvidenceIndex + 1)}
                  onClose={() => setSelectedEvidenceId(null)}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});

CheckRow.displayName = 'CheckRow';

const ReportPageState = memo<{
  action?: ReactNode;
  description: string;
  icon: typeof AlertTriangle;
  title: string;
}>(({ action, description, icon, title }) => (
  <Center gap={16} height={'100%'} style={{ minHeight: '70vh' }} width={'100%'}>
    <Empty description={description} icon={icon} title={title} />
    {action}
  </Center>
));

const formatScopeDate = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const safeWebUrl = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const pullRequestLabel = (
  pullRequest: NonNullable<VerifyCodingScope['pullRequest']>,
  t: TFunction<'verify'>,
) => {
  if (pullRequest.number === undefined || pullRequest.number === null)
    return t('report.scope.pullRequest');

  return t('report.scope.pullRequestNumber', {
    number: String(pullRequest.number).replace(/^#/, ''),
  });
};

/**
 * One line of provenance: the PR, the code, when, and where it ran. Reference
 * material — the reader scans it to place the report, then moves on — so it
 * stays subordinate to the verdict and the summary above it, and never grows
 * into a stack of labelled rows.
 */
const CodingScopeCard = memo<{
  context: VerifyCodingScope | null | undefined;
  origin?: VerifyRunOrigin;
}>(({ context, origin }) => {
  const { t } = useTranslation('verify');
  if (!context) return null;

  const { branch, commit, entry, pullRequest, testedAt } = context;
  const hasPullRequest = Boolean(
    pullRequest && (pullRequest.number !== undefined || pullRequest.title || pullRequest.url),
  );
  const date = formatScopeDate(testedAt);
  const surfaces = renderableSurfaces(context.surfaces);
  const originHref = originTopicHref(origin);
  const hasScope =
    Boolean(branch) ||
    Boolean(commit) ||
    Boolean(entry) ||
    hasPullRequest ||
    surfaces.length > 0 ||
    Boolean(date) ||
    Boolean(originHref);

  if (!hasScope) return null;

  const pullRequestUrl = safeWebUrl(pullRequest?.url);
  const pullRequestContent =
    hasPullRequest && pullRequest ? (
      <>
        <Icon className={stylex.props(styles.prIcon).className} icon={GitPullRequest} size={15} />
        <span {...stylex.props(styles.prNumber)}>{pullRequestLabel(pullRequest, t)}</span>
        {pullRequest.title && <span {...stylex.props(styles.prTitle)}>{pullRequest.title}</span>}
        {pullRequestUrl && <Icon icon={ExternalLink} size={13} />}
      </>
    ) : null;
  const shortCommit = commit && commit.length > 12 ? commit.slice(0, 10) : commit;

  return (
    <div {...stylex.props(styles.codingScope)}>
      {pullRequestContent && (
        <div {...stylex.props(styles.scopePullRequestLine)}>
          {pullRequestUrl ? (
            <a
              {...stylex.props(styles.prChip, styles.prChipLink)}
              data-link={true}
              href={pullRequestUrl}
              rel="noreferrer"
              target="_blank"
              title={pullRequest?.title ?? pullRequestUrl}
            >
              {pullRequestContent}
            </a>
          ) : (
            <span {...stylex.props(styles.prChip)} title={pullRequest?.title}>
              {pullRequestContent}
            </span>
          )}
        </div>
      )}

      <div {...stylex.props(styles.scopeMetaLine)}>
        {branch && (
          <span {...stylex.props(styles.branchChip)} title={branch}>
            <Icon className={stylex.props(styles.chipIcon).className} icon={GitBranch} size={15} />
            <code {...stylex.props(styles.chipCode)}>{branch}</code>
          </span>
        )}
        {commit && (
          <span {...stylex.props(styles.commitChip)} title={commit}>
            <Icon className={stylex.props(styles.chipIcon).className} icon={GitCommit} size={14} />
            <code {...stylex.props(styles.commitCode)}>{shortCommit}</code>
          </span>
        )}
        {date && (
          <span {...stylex.props(styles.scopeMetaItem)}>
            <Icon
              className={stylex.props(styles.chipIcon).className}
              icon={CalendarClock}
              size={13}
            />
            <span>{date}</span>
          </span>
        )}
        {surfaces.length > 0 && (
          <span {...stylex.props(styles.surfaceList)}>
            {surfaces.map((surface) => (
              <span {...stylex.props(styles.surfaceChip)} key={surface}>
                <Icon
                  className={stylex.props(styles.surfaceIcon).className}
                  icon={SURFACE_ICON[surface]}
                  size={12}
                />
                {t(`report.surface.${surface}`)}
              </span>
            ))}
          </span>
        )}
        {entry && (
          <span {...stylex.props(styles.scopeMetaItem, styles.scopeEntry)} title={entry}>
            <Icon className={stylex.props(styles.chipIcon).className} icon={Terminal} size={13} />
            <code {...stylex.props(styles.chipCode)}>{entry}</code>
          </span>
        )}
        {/* Only ever rendered for the report's author — the server redacts `origin`
            from a bundle fetched by anyone else holding the shared link. */}
        {originHref && (
          <a
            {...stylex.props(styles.scopeMetaItem, styles.originLink, stylex.defaultMarker())}
            href={originHref}
            rel="noreferrer"
            target="_blank"
            title={t('report.scope.origin')}
          >
            <Icon
              className={stylex.props(styles.originLinkIcon).className}
              icon={MessagesSquare}
              size={13}
            />
            <Icon
              className={stylex.props(styles.originLinkIcon).className}
              icon={ExternalLink}
              size={11}
            />
          </a>
        )}
      </div>
    </div>
  );
});

CodingScopeCard.displayName = 'CodingScopeCard';

/**
 * The report detail pane. Renders the verdict hero,
 * every check as a severity-ordered expandable row (failed rows open by default),
 * and the full narrative behind a collapsed disclosure. Addressed by `:runId`;
 * refreshes itself while the run is non-terminal.
 */
interface ReportViewerProps {
  runId?: string;
}

const ReportViewer = memo<ReportViewerProps>(({ runId: explicitRunId }) => {
  const { t } = useTranslation('verify');
  const { runId: routeRunId } = useParams<{ runId: string }>();
  // Route params come from shared links whose autolinker may have glued
  // trailing punctuation onto the id — salvage the leading UUID.
  const verifyRunId = explicitRunId ?? extractUuid(routeRunId) ?? null;
  const { data, error, isLoading, mutate } = useVerifyReportBundle(verifyRunId);

  useEffect(() => {
    const status = data?.run.status;
    if (!status || terminalRunStatuses.has(status)) return;
    const timer = window.setInterval(() => void mutate(), 5000);
    return () => window.clearInterval(timer);
  }, [data?.run.status, mutate]);

  const ordered = useMemo(() => {
    if (!data) return [];
    return buildCheckRows((data.run.plan as VerifyCheckItem[] | null) ?? null, data.results);
  }, [data]);

  if (!verifyRunId) {
    return (
      <ReportPageState
        description={t('report.missing.description')}
        icon={AlertTriangle}
        title={t('report.missing.title')}
      />
    );
  }
  if (isLoading) return <Loading debugId="verify-report-viewer" />;
  if (error) {
    return (
      <ReportPageState
        description={t('report.error.description')}
        icon={X}
        title={t('report.error.title')}
        action={
          <Button icon={<RefreshCw size={16} />} onClick={() => void mutate()}>
            {t('report.actions.retry')}
          </Button>
        }
      />
    );
  }
  if (!data) {
    return (
      <ReportPageState
        description={t('report.notFound.description')}
        icon={FileText}
        title={t('report.notFound.title')}
      />
    );
  }

  const { run, report } = data;
  const liveStatus =
    run.status && !terminalRunStatuses.has(run.status)
      ? (run.status as keyof typeof liveStatusLabelKey)
      : null;

  const verdict = (report?.verdict as VerifyVerdict | null) ?? null;
  // The verdict-filter bar is gone, so every row of the round renders. The
  // per-verdict tallies went with it: they existed to label its chips, and the
  // verdict pill above already states the round's outcome.
  const visible = ordered;
  const isCodingReport = run.scenario === 'coding';
  const interactionCost = readInteractionCost(run.metadata);
  // The server strips `origin` for anyone but the author; `isOwner` keeps the
  // affordance off the page for a visitor even if that ever regressed.
  const origin = data.isOwner ? run.metadata?.origin : undefined;

  return (
    <div {...stylex.props(styles.scroll)}>
      <div {...stylex.props(styles.page)}>
        <main>
          <Flexbox gap={12}>
            {/* Verdict above the title, not trailing it — the same order the
                acceptance page uses. A badge parked after a long title wraps
                to its own line anyway, and then reads as an afterthought
                rather than as the report's headline state. */}
            {verdict && (
              <div {...sx([styles.heroLine], undefined, { marginBlockEnd: 2 })}>
                <span
                  {...sx([styles.pill], undefined, {
                    background: VERDICT_META[verdict].bg,
                    color: VERDICT_META[verdict].color,
                  })}
                >
                  <Icon icon={VERDICT_META[verdict].icon} size={15} />
                  {t(`report.verdict.${verdict}`)}
                </span>
              </div>
            )}
            <Text as={'h1'} style={{ fontSize: 24, lineHeight: 1.3, margin: 0 }}>
              {run.title || t('report.titleFallback')}
            </Text>

            {!isCodingReport && run.goal && (
              <Text className={stylex.props(styles.summary).className}>{run.goal}</Text>
            )}
            {report?.summary && (
              <Text className={stylex.props(styles.summary).className}>{report.summary}</Text>
            )}

            {isCodingReport && (
              <CodingScopeCard
                context={run.context as VerifyCodingScope | null | undefined}
                origin={origin}
              />
            )}

            {liveStatus && (
              <div {...stylex.props(styles.liveBanner)}>
                <Icon icon={Clock3} size={14} />
                {t(liveStatusLabelKey[liveStatus])}
              </div>
            )}
          </Flexbox>

          {visible.length > 0 ? (
            <div {...stylex.props(styles.checks)}>
              {visible.map((row) => (
                /* Every row opens. A report is read to see what was actually
                   observed, and a page of collapsed titles makes the reader
                   click N times to learn that. */
                <CheckRow defaultOpen key={row.id} row={row} />
              ))}
            </div>
          ) : (
            <Block align={'center'} padding={24}>
              <Text type={'secondary'}>{t('report.filterEmpty')}</Text>
            </Block>
          )}

          {report?.content && (
            <details {...stylex.props(styles.narrative, stylex.defaultMarker())}>
              <summary {...sx([styles.narrativeSummary], summaryStyles.summary)}>
                <Icon icon={ChevronRight} size={13} />
                {t('report.sections.details')}
              </summary>
              <div {...stylex.props(styles.narrativeBody, styles.narrativeContent)}>
                <Markdown>{report.content}</Markdown>
              </div>
            </details>
          )}

          {interactionCost && (
            <details {...stylex.props(styles.narrative, stylex.defaultMarker())}>
              <summary {...sx([styles.narrativeSummary], summaryStyles.summary)}>
                <Icon icon={ChevronRight} size={13} />
                {t('report.interaction.title')}
              </summary>
              <div {...stylex.props(styles.interactionCostBody, styles.narrativeContent)}>
                <InteractionCostPanel cost={interactionCost} />
              </div>
            </details>
          )}
        </main>
      </div>
    </div>
  );
});

export default ReportViewer;
