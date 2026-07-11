'use client';

import type {
  VerifyCodingScope,
  VerifyEvidenceType,
  VerifyInteractionCost,
  VerifyInteractionCostOperators,
  VerifyInteractionCostPhase,
} from '@lobechat/types';
import { toRecord } from '@lobechat/utils/object';
import {
  Block,
  Center,
  Drawer,
  Empty,
  Flexbox,
  Highlighter,
  Icon,
  Image,
  Markdown,
  Text,
} from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileText,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Image as ImageIcon,
  Layers,
  RefreshCw,
  Target,
  Terminal,
  Video,
  X,
} from 'lucide-react';
import { memo, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import { useTextFileLoader } from '@/features/FileViewer/hooks/useTextFileLoader';
import type { VerifyEvidenceWithUrl, VerifyResultWithEvidence } from '@/services/verify';
import { getLanguageFromFilename } from '@/utils/fileLanguage';

import { useVerifyReportBundle } from './hooks';

type Verdict = 'passed' | 'failed' | 'uncertain';
type Filter = 'all' | Verdict;

/** Best-effort filename from a (possibly signed) file URL, for syntax highlighting. */
const filenameFromUrl = (url: string): string => {
  try {
    return new URL(url).pathname.split('/').pop() || 'document';
  } catch {
    return 'document';
  }
};

const styles = createStaticStyles(({ css }) => ({
  scroll: css`
    overflow: auto;
    width: 100%;
    height: 100%;
  `,
  page: css`
    width: 100%;
    max-width: 1180px;
    margin-inline: auto;
    padding-block: 32px 64px;
    padding-inline: 32px;
  `,

  /* hero */
  heroLine: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  `,
  pill: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    padding-block: 5px;
    padding-inline: 13px;
    border-radius: 999px;

    font-size: 13px;
    font-weight: 600;
    line-height: 1;
  `,
  summary: css`
    max-width: 100%;
    color: ${cssVar.colorText};
  `,
  meta: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    margin-block-start: 4px;
  `,
  metaItem: css`
    display: inline-flex;
    gap: 6px;
    align-items: baseline;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    code {
      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
      word-break: break-word;
    }
  `,
  liveBanner: css`
    display: inline-flex;
    gap: 8px;
    align-items: center;

    width: fit-content;
    margin-block-start: 4px;
    padding-block: 6px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorInfoBorder};
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorInfoText};

    background: ${cssVar.colorInfoBg};
  `,
  interactionCost: css`
    --klm-blue-1: color-mix(in srgb, ${cssVar.colorInfo} 70%, ${cssVar.colorBgContainer});
    --klm-blue-2: ${cssVar.colorInfo};
    --klm-blue-3: color-mix(in srgb, ${cssVar.colorInfo} 84%, ${cssVar.colorText});
    --klm-blue-4: color-mix(in srgb, ${cssVar.colorInfo} 68%, ${cssVar.colorText});
    --klm-blue-5: color-mix(in srgb, ${cssVar.colorInfo} 54%, ${cssVar.colorText});
    --klm-blue-6: color-mix(in srgb, ${cssVar.colorInfo} 42%, ${cssVar.colorText});

    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
  `,
  interactionCostHeader: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    justify-content: flex-end;
  `,
  interactionCostModel: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  interactionMetrics: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;

    @media (width <= 520px) {
      grid-template-columns: 1fr;
    }
  `,
  interactionMetric: css`
    min-width: 0;
    padding-block: 9px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusSM};
  `,
  interactionMetricLabel: css`
    display: block;
    margin-block-end: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  interactionMetricValue: css`
    font-size: 18px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    color: ${cssVar.colorText};
  `,
  operatorList: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
  `,
  operatorChip: css`
    --operator-color: ${cssVar.colorTextSecondary};

    display: inline-flex;
    gap: 5px;
    align-items: baseline;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: color-mix(in srgb, var(--operator-color) 72%, ${cssVar.colorTextSecondary});

    &::before {
      content: '';

      flex: 0 0 auto;

      width: 6px;
      height: 6px;
      margin-block-start: 0.5em;
      border-radius: 50%;

      background: var(--operator-color);
    }

    b {
      font-weight: 650;
      color: var(--operator-color);
    }

    &[data-operator='K'] {
      --operator-color: var(--klm-blue-1);
    }

    &[data-operator='P'] {
      --operator-color: var(--klm-blue-2);
    }

    &[data-operator='M'] {
      --operator-color: var(--klm-blue-3);
    }

    &[data-operator='H'] {
      --operator-color: var(--klm-blue-4);
    }

    &[data-operator='T_chars'] {
      --operator-color: var(--klm-blue-5);
    }

    &[data-operator='R_ms'] {
      --operator-color: var(--klm-blue-6);
    }
  `,
  phaseList: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  phaseRow: css`
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(140px, 1.6fr) auto;
    gap: 10px;
    align-items: center;

    @media (width <= 640px) {
      grid-template-columns: 1fr;
      gap: 5px;
    }
  `,
  phaseName: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  phaseTrack: css`
    overflow: hidden;
    display: flex;

    height: 8px;
    border-radius: 999px;

    background: transparent;
    box-shadow: inset 0 0 0 1px ${cssVar.colorBorderSecondary};
  `,
  phaseSegment: css`
    --operator-color: ${cssVar.colorTextSecondary};

    flex: 0 0 auto;
    min-width: 2px;
    height: 100%;
    background: var(--operator-color);

    &[data-operator='K'] {
      --operator-color: var(--klm-blue-1);
    }

    &[data-operator='P'] {
      --operator-color: var(--klm-blue-2);
    }

    &[data-operator='M'] {
      --operator-color: var(--klm-blue-3);
    }

    &[data-operator='H'] {
      --operator-color: var(--klm-blue-4);
    }

    &[data-operator='T_chars'] {
      --operator-color: var(--klm-blue-5);
    }

    &[data-operator='R_ms'] {
      --operator-color: var(--klm-blue-6);
    }
  `,
  phaseValue: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  codingScope: css`
    display: flex;
    flex-direction: column;
    gap: 6px;

    max-width: 100%;
    margin-block-start: 8px;
  `,
  codingScopeMain: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    align-items: center;

    min-width: 0;
  `,
  branchChip: css`
    display: inline-flex;
    flex: 0 1 auto;
    gap: 6px;
    align-items: center;

    min-width: 0;
    max-width: 360px;

    color: ${cssVar.colorTextTertiary};

    code {
      overflow: hidden;

      min-width: 0;

      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    svg {
      flex: 0 0 auto;
      color: ${cssVar.colorTextQuaternary};
    }
  `,
  commitChip: css`
    display: inline-flex;
    flex: 0 0 auto;
    gap: 6px;
    align-items: center;

    color: ${cssVar.colorTextTertiary};

    code {
      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
      color: ${cssVar.colorTextTertiary};
    }

    svg {
      flex: 0 0 auto;
      color: ${cssVar.colorTextQuaternary};
    }
  `,
  prChip: css`
    cursor: default;

    display: inline-flex;
    flex: 0 1 auto;
    gap: 6px;
    align-items: center;

    min-width: 0;
    max-width: 420px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-decoration: none;

    &[data-link='true'] {
      cursor: pointer;
    }

    &[data-link='true']:hover {
      color: ${cssVar.colorLink};
    }

    > svg:first-child {
      flex: 0 0 auto;
      color: ${cssVar.colorTextQuaternary};
    }
  `,
  prNumber: css`
    flex: 0 0 auto;
    color: ${cssVar.colorTextSecondary};
  `,
  prTitle: css`
    overflow: hidden;
    flex: 1 1 auto;

    min-width: 0;

    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  scopeMetaRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    align-items: center;

    min-width: 0;
  `,
  scopeMetaItem: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    min-width: 0;
    max-width: 100%;

    font-size: 12px;
    line-height: 1.45;
    color: ${cssVar.colorTextTertiary};

    code {
      overflow: hidden;

      min-width: 0;

      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  scopeFocus: css`
    display: inline-flex;
    gap: 6px;
    align-items: flex-start;

    max-width: 72ch;

    font-size: 13px;
    line-height: 1.45;
    color: ${cssVar.colorTextSecondary};
  `,
  surfaceList: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  `,
  surfaceChip: css`
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,

  /* sticky filter chips */
  stats: css`
    position: sticky;
    z-index: 10;
    inset-block-start: 0;

    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    margin-block: 20px 12px;
    padding-block: 12px;

    background: color-mix(in srgb, ${cssVar.colorBgContainer} 88%, transparent);
    backdrop-filter: blur(8px);
  `,
  chip: css`
    cursor: pointer;

    display: inline-flex;
    gap: 7px;
    align-items: center;

    height: 28px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    transition: background 0.12s ease;

    b {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: ${cssVar.colorText};
    }

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &[data-active='true'] {
      border-color: ${cssVar.colorBorder};
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  dot: css`
    width: 7px;
    height: 7px;
    border-radius: 999px;
  `,
  score: css`
    cursor: default;
    margin-inline-start: auto;
    border-color: transparent;
    color: ${cssVar.colorTextTertiary};

    b {
      color: ${cssVar.colorTextSecondary};
    }
  `,

  /* checks */
  checks: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};
  `,
  row: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  rowHead: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;

    width: 100%;
    padding-block: 11px;
    padding-inline: 16px;
    border: none;

    text-align: start;

    background: none;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  rowTitle: css`
    overflow: hidden;

    font-size: 14px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    &[data-failed='true'] {
      font-weight: 600;
    }
  `,
  rowSide: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  softTag: css`
    padding-block: 1px;
    padding-inline: 7px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillTertiary};
  `,
  chev: css`
    color: ${cssVar.colorTextQuaternary};
    transition: transform 0.15s ease;

    &[data-open='true'] {
      transform: rotate(90deg);
    }
  `,
  rowBody: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    padding-block: 2px 16px;
    padding-inline: 46px 16px;
  `,
  reasoning: css`
    max-width: 70ch;
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  suggestion: css`
    max-width: 70ch;
    padding-inline-start: 10px;
    border-inline-start: 2px solid ${cssVar.colorBorder};

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,

  /* narrative */
  narrative: css`
    margin-block-start: 24px;

    &:not([open]) > :not(summary) {
      display: none;
    }
  `,
  narrativeSummary: css`
    cursor: pointer;
    user-select: none;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  narrativeBody: css`
    margin-block-start: 12px;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,
  interactionCostBody: css`
    margin-block-start: 12px;
  `,

  /* evidence */
  evidenceList: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;

    max-width: 70ch;
  `,
  evidenceFile: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 8px;
    align-items: center;

    width: min(100%, 520px);
    padding-block: 7px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    text-align: start;

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      border-color: ${cssVar.colorLink};
      color: ${cssVar.colorLink};
    }
  `,
  evidenceFileIcon: css`
    display: flex;
    color: ${cssVar.colorTextTertiary};
  `,
  evidenceFileBody: css`
    display: flex;
    flex-direction: column;
    min-width: 0;
  `,
  evidenceFileName: css`
    overflow: hidden;

    font-size: 13px;
    line-height: 1.35;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  evidenceFileDesc: css`
    overflow: hidden;

    margin-block-start: 2px;

    font-size: 12px;
    line-height: 1.35;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  evidenceText: css`
    overflow: auto;

    max-height: 200px;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  evidenceVideo: css`
    align-self: flex-start;

    width: auto;
    max-width: 100%;
    max-height: 360px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    object-fit: contain;
  `,
  evChip: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 999px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillTertiary};
  `,
  evidenceDoc: css`
    overflow: hidden;

    width: 100%;
    height: 320px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  docViewer: css`
    overflow: auto;
    height: 100%;
    padding-block: 12px;
    padding-inline: 16px;
  `,
}));

const VERDICT_META: Record<
  Verdict,
  { bg: string; color: string; dot: string; icon: typeof Check; labelKey: string }
> = {
  failed: {
    bg: cssVar.colorErrorBg,
    color: cssVar.colorErrorText,
    dot: cssVar.colorError,
    icon: X,
    labelKey: 'report.verdict.failed',
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

const imageEvidenceTypes = new Set(['gif', 'screenshot']);
/** Visual media that renders/plays inline in the check body, no click-to-open. */
const isInlineVisualEvidence = (evidence: VerifyEvidenceWithUrl) =>
  Boolean(evidence.fileUrl && (imageEvidenceTypes.has(evidence.type) || evidence.type === 'video'));

/** Evidence with a directly renderable payload in the check body, no click-to-open. */
const isInlineEvidence = (evidence: VerifyEvidenceWithUrl) =>
  Boolean(evidence.content) || isInlineVisualEvidence(evidence);

/** Coarse attachment bucket for the type marker: image / video / everything else. */
type EvidenceCategory = 'file' | 'image' | 'video';
const evidenceCategory = (type: VerifyEvidenceType): EvidenceCategory =>
  type === 'video' ? 'video' : imageEvidenceTypes.has(type) ? 'image' : 'file';
const CATEGORY_ICON: Record<EvidenceCategory, typeof FileText> = {
  file: FileText,
  image: ImageIcon,
  video: Video,
};
const CATEGORY_ORDER: EvidenceCategory[] = ['image', 'video', 'file'];
// `errored` is terminal too (the verifier couldn't run) — stop polling and don't
// treat it as a live/in-progress status.
const terminalRunStatuses = new Set(['delivered', 'errored', 'failed', 'passed']);
const liveStatusLabelKey = {
  planned: 'report.status.planned',
  repairing: 'report.status.repairing',
  unverified: 'report.status.unverified',
  verifying: 'report.status.verifying',
} as const;

const OPERATOR_KEYS = ['K', 'P', 'M', 'H', 'T_chars', 'R_ms'] as const;
type OperatorKey = (typeof OPERATOR_KEYS)[number];

const OPERATOR_DEFAULT_SECONDS: Record<OperatorKey, number> = {
  H: 0.4,
  K: 0.2,
  M: 1.35,
  P: 1.1,
  R_ms: 0.001,
  T_chars: 0.2,
};

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const finiteString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const readOperators = (value: unknown): VerifyInteractionCostOperators => {
  const record = toRecord(value);
  if (!record) return {};

  return {
    H: finiteNumber(record.H),
    K: finiteNumber(record.K),
    M: finiteNumber(record.M),
    P: finiteNumber(record.P),
    R_ms: finiteNumber(record.R_ms),
    T_chars: finiteNumber(record.T_chars),
  };
};

const readTimingSeconds = (value: unknown): Record<string, number> | undefined => {
  const record = toRecord(value);
  if (!record) return undefined;

  const entries = Object.entries(record).flatMap(([key, field]) => {
    const seconds = finiteNumber(field);
    return seconds === undefined ? [] : [[key, seconds] as const];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const readPhase = (value: unknown, index: number): VerifyInteractionCostPhase | null => {
  const record = toRecord(value);
  if (!record) return null;

  const seconds = finiteNumber(record.seconds);
  const activeSeconds = finiteNumber(record.activeSeconds);
  const waitSeconds = finiteNumber(record.waitSeconds);
  const hasTiming =
    seconds !== undefined || activeSeconds !== undefined || waitSeconds !== undefined;
  if (!hasTiming) return null;

  return {
    actionCount: finiteNumber(record.actionCount),
    activeSeconds,
    checkItemId: finiteString(record.checkItemId),
    id: finiteString(record.id) ?? `phase-${index + 1}`,
    label: finiteString(record.label),
    operators: readOperators(record.operators),
    seconds,
    waitSeconds,
  };
};

const readInteractionCost = (metadata: unknown): VerifyInteractionCost | null => {
  const cost = toRecord(toRecord(metadata)?.interactionCost);
  if (!cost) return null;

  const totalSeconds = finiteNumber(cost.totalSeconds);
  if (totalSeconds === undefined) return null;

  return {
    actionCount: finiteNumber(cost.actionCount),
    activeSeconds: finiteNumber(cost.activeSeconds) ?? 0,
    model: finiteString(cost.model) ?? 'goms-klm',
    operators: readOperators(cost.operators),
    phases: Array.isArray(cost.phases)
      ? cost.phases
          .map((phase, index) => readPhase(phase, index))
          .filter((phase): phase is VerifyInteractionCostPhase => Boolean(phase))
      : [],
    scope: finiteString(cost.scope),
    sourceTrace: finiteString(cost.sourceTrace),
    timingSeconds: readTimingSeconds(cost.timingSeconds),
    totalSeconds,
    waitSeconds: finiteNumber(cost.waitSeconds) ?? 0,
  };
};

const formatSeconds = (seconds: number): string =>
  `${seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)}s`;

const phaseSeconds = (phase: VerifyInteractionCostPhase): number =>
  phase.seconds ?? (phase.activeSeconds ?? 0) + (phase.waitSeconds ?? 0);

const operatorSeconds = (
  key: OperatorKey,
  value: number,
  timingSeconds?: Record<string, number>,
): number => {
  if (key === 'R_ms') return value / 1000;
  if (key === 'T_chars') {
    return (
      value * (timingSeconds?.T_chars ?? timingSeconds?.T_char ?? OPERATOR_DEFAULT_SECONDS[key])
    );
  }

  return value * (timingSeconds?.[key] ?? OPERATOR_DEFAULT_SECONDS[key]);
};

const operatorValue = (key: OperatorKey, value: number): string => {
  if (key === 'R_ms') return formatSeconds(value / 1000);
  if (key === 'T_chars') return `${Math.round(value)} chars`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
};

const phaseOperatorSegments = (
  phase: VerifyInteractionCostPhase,
  timingSeconds?: Record<string, number>,
): { key: OperatorKey; seconds: number; value: number }[] =>
  OPERATOR_KEYS.flatMap((key) => {
    const value = phase.operators?.[key];
    if (value === undefined || value <= 0) return [];

    const seconds = operatorSeconds(key, value, timingSeconds);
    return seconds > 0 ? [{ key, seconds, value }] : [];
  });

/** Severity-first sort: failed → uncertain → passed. */
const SEVERITY_RANK: Record<Verdict, number> = { failed: 0, passed: 2, uncertain: 1 };

const checkVerdict = (result: VerifyResultWithEvidence): Verdict => {
  const v = result.verdict ?? result.status;
  if (v === 'passed' || v === 'failed' || v === 'uncertain') return v;
  return 'uncertain';
};

const evidenceDisplayName = (
  evidence: VerifyEvidenceWithUrl,
  t: TFunction<'verify'>,
  index: number,
) =>
  evidence.fileName ||
  (evidence.fileUrl ? filenameFromUrl(evidence.fileUrl) : '') ||
  evidence.description ||
  t('report.evidence.inlineFallback', { index });

/** A file-backed text evidence, decoded + syntax highlighted (avoids mojibake). */
const DocumentViewer = memo<{ fileName?: string | null; url: string }>(({ fileName, url }) => {
  const { t } = useTranslation('verify');
  const { fileData, loading, error } = useTextFileLoader(url);

  if (loading)
    return (
      <Center flex={1} height={'100%'}>
        <Loading debugId="verify-document-viewer" />
      </Center>
    );

  if (error || fileData === null)
    return (
      <Center flex={1} gap={8} height={'100%'}>
        <Text type="secondary">{t('report.document.failed')}</Text>
        <a href={url} rel="noreferrer" target="_blank">
          {t('report.document.openOriginal')}
        </a>
      </Center>
    );

  return (
    <Flexbox className={styles.docViewer}>
      <Highlighter
        wrap
        language={getLanguageFromFilename(fileName || filenameFromUrl(url))}
        showLanguage={false}
        variant={'borderless'}
      >
        {fileData}
      </Highlighter>
    </Flexbox>
  );
});

const InteractionCostPanel = memo<{ cost: VerifyInteractionCost }>(({ cost }) => {
  const { t } = useTranslation('verify');
  const phases = cost.phases ?? [];
  const maxPhaseSeconds = Math.max(...phases.map(phaseSeconds), 0);
  const metrics = [
    {
      label: t('report.interaction.total'),
      value: formatSeconds(cost.totalSeconds),
    },
    {
      label: t('report.interaction.active'),
      value: formatSeconds(cost.activeSeconds),
    },
    {
      label: t('report.interaction.wait'),
      value: formatSeconds(cost.waitSeconds),
    },
  ];

  return (
    <section className={styles.interactionCost}>
      <div className={styles.interactionCostHeader}>
        <span className={styles.interactionCostModel}>{cost.model}</span>
      </div>

      <div className={styles.interactionMetrics}>
        {metrics.map((metric) => (
          <div className={styles.interactionMetric} key={metric.label}>
            <span className={styles.interactionMetricLabel}>{metric.label}</span>
            <span className={styles.interactionMetricValue}>{metric.value}</span>
          </div>
        ))}
      </div>

      <div className={styles.operatorList}>
        {OPERATOR_KEYS.map((key) => {
          const value = cost.operators[key];
          if (value === undefined) return null;

          return (
            <span className={styles.operatorChip} data-operator={key} key={key}>
              <span>{t(`report.interaction.operator.${key}`)}</span>
              <b>{operatorValue(key, value)}</b>
            </span>
          );
        })}
      </div>

      {phases.length > 0 && (
        <div className={styles.phaseList}>
          {phases.map((phase) => {
            const seconds = phaseSeconds(phase);
            const activeSeconds = phase.activeSeconds ?? 0;
            const waitSeconds = phase.waitSeconds ?? 0;
            const activeWidth = maxPhaseSeconds > 0 ? (activeSeconds / maxPhaseSeconds) * 100 : 0;
            const waitWidth = maxPhaseSeconds > 0 ? (waitSeconds / maxPhaseSeconds) * 100 : 0;
            const segments = phaseOperatorSegments(phase, cost.timingSeconds);

            return (
              <div className={styles.phaseRow} key={phase.id}>
                <span className={styles.phaseName} title={phase.label ?? phase.id}>
                  {phase.label ?? phase.id}
                </span>
                <span className={styles.phaseTrack}>
                  {segments.length > 0 ? (
                    segments.map((segment) => (
                      <span
                        className={styles.phaseSegment}
                        data-operator={segment.key}
                        key={segment.key}
                        style={{
                          width: `${
                            maxPhaseSeconds > 0 ? (segment.seconds / maxPhaseSeconds) * 100 : 0
                          }%`,
                        }}
                        title={`${t(`report.interaction.operator.${segment.key}`)} ${formatSeconds(
                          segment.seconds,
                        )}`}
                      />
                    ))
                  ) : (
                    <>
                      <span className={styles.phaseSegment} style={{ width: `${activeWidth}%` }} />
                      <span
                        className={styles.phaseSegment}
                        data-operator={'R_ms'}
                        style={{ width: `${waitWidth}%` }}
                      />
                    </>
                  )}
                </span>
                <span className={styles.phaseValue}>{formatSeconds(seconds)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
});

InteractionCostPanel.displayName = 'InteractionCostPanel';

/** One evidence artifact rendered by its type: zoomable image/gif, video, doc, text. */
const EvidenceItem = memo<{ evidence: VerifyEvidenceWithUrl; index: number }>(
  ({ evidence: e, index }) => {
    const { t } = useTranslation('verify');
    const label = evidenceDisplayName(e, t, index);
    const description = e.description && e.description !== label ? e.description : null;
    // Inline media (image/gif/video) speaks for itself — the raw filename header
    // is visual noise, so only keep a meaningful caption (description) for it.
    const isMedia = isInlineVisualEvidence(e);

    return (
      <Flexbox gap={6}>
        {!isMedia && (
          <Text strong fontSize={13}>
            {label}
          </Text>
        )}
        {description && (
          <Text fontSize={13} type={'secondary'}>
            {description}
          </Text>
        )}
        {e.fileUrl && imageEvidenceTypes.has(e.type) ? (
          <Flexbox align={'flex-start'} style={{ maxWidth: '100%' }}>
            <Image
              preview
              alt={e.description ?? label}
              src={e.fileUrl}
              style={{ maxWidth: '100%' }}
              variant={'outlined'}
            />
          </Flexbox>
        ) : e.fileUrl && e.type === 'video' ? (
          <video controls className={styles.evidenceVideo} src={e.fileUrl} />
        ) : e.fileUrl ? (
          <div className={styles.evidenceDoc}>
            <DocumentViewer fileName={e.fileName} url={e.fileUrl} />
          </div>
        ) : e.content ? (
          <div className={styles.evidenceText}>{e.content}</div>
        ) : (
          <span className={styles.softTag}>{e.type}</span>
        )}
      </Flexbox>
    );
  },
);

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
      className={styles.evidenceFile}
      title={t('report.evidence.openDetail', { name })}
      type={'button'}
      onClick={onClick}
    >
      <span className={styles.evidenceFileIcon}>
        <Icon icon={CATEGORY_ICON[evidenceCategory(evidence.type)]} size={13} />
      </span>
      <span className={styles.evidenceFileBody}>
        <span className={styles.evidenceFileName}>{name}</span>
        {description && <span className={styles.evidenceFileDesc}>{description}</span>}
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
  <Drawer
    destroyOnHidden
    containerMaxWidth={'100%'}
    open={open}
    placement={'right'}
    title={title}
    width={'min(1120px, calc(100vw - 48px))'}
    styles={{
      body: {
        height: '100%',
        padding: 0,
      },
      bodyContent: {
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
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
  </Drawer>
));

EvidenceItem.displayName = 'EvidenceItem';

EvidenceDrawer.displayName = 'EvidenceDrawer';

/** One check — an expandable row; evidence opens one artifact at a time. */
const CheckRow = memo<{ defaultOpen: boolean; result: VerifyResultWithEvidence }>(
  ({ defaultOpen, result }) => {
    const { t } = useTranslation('verify');
    const [open, setOpen] = useState(defaultOpen);
    const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
    const verdict = checkVerdict(result);
    const meta = VERDICT_META[verdict];
    const evidenceCount = result.evidence.length;
    const categoryCounts = result.evidence.reduce(
      (acc, e) => {
        acc[evidenceCategory(e.type)] += 1;
        return acc;
      },
      { file: 0, image: 0, video: 0 } as Record<EvidenceCategory, number>,
    );
    const hasBody =
      Boolean(result.toulmin?.evidence) || Boolean(result.suggestion) || evidenceCount > 0;
    const selectedEvidenceIndex = selectedEvidenceId
      ? result.evidence.findIndex((e) => e.id === selectedEvidenceId)
      : -1;
    const selectedEvidence =
      selectedEvidenceIndex >= 0 ? result.evidence[selectedEvidenceIndex] : null;

    return (
      <div className={styles.row}>
        <button
          className={styles.rowHead}
          type={'button'}
          onClick={() => hasBody && setOpen((o) => !o)}
        >
          <span style={{ color: meta.dot, display: 'flex' }}>
            <Icon icon={meta.icon} size={16} />
          </span>
          <span className={styles.rowTitle} data-failed={verdict === 'failed'}>
            {result.checkItemTitle || result.checkItemId}
          </span>
          <span className={styles.rowSide}>
            {CATEGORY_ORDER.map((cat) =>
              categoryCounts[cat] > 0 ? (
                <span
                  className={styles.evChip}
                  key={cat}
                  title={`${t(`report.evidence.category.${cat}`)} × ${categoryCounts[cat]}`}
                >
                  <Icon icon={CATEGORY_ICON[cat]} size={12} />
                  {categoryCounts[cat]}
                </span>
              ) : null,
            )}
            {!result.required && (
              <span className={styles.softTag}>{t('report.check.optional')}</span>
            )}
            {hasBody && (
              <Icon className={styles.chev} data-open={open} icon={ChevronRight} size={14} />
            )}
          </span>
        </button>
        {open && hasBody && (
          <div className={styles.rowBody}>
            {result.toulmin?.evidence && (
              <p className={styles.reasoning}>{result.toulmin.evidence}</p>
            )}
            {result.suggestion && <p className={styles.suggestion}>{result.suggestion}</p>}
            {evidenceCount > 0 && (
              <>
                <div className={styles.evidenceList}>
                  {result.evidence.map((e, index) =>
                    isInlineEvidence(e) ? (
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
  },
);

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

const CodingScopeCard = memo<{ context: VerifyCodingScope | null | undefined }>(({ context }) => {
  const { t } = useTranslation('verify');
  if (!context) return null;

  const { branch, commit, entry, focus, pullRequest, surfaces, testedAt } = context;
  const hasPullRequest = Boolean(
    pullRequest && (pullRequest.number !== undefined || pullRequest.title || pullRequest.url),
  );
  const date = formatScopeDate(testedAt);
  const hasScope =
    Boolean(branch) ||
    Boolean(commit) ||
    Boolean(entry) ||
    Boolean(focus) ||
    hasPullRequest ||
    Boolean(surfaces?.length) ||
    Boolean(date);

  if (!hasScope) return null;

  const pullRequestUrl = safeWebUrl(pullRequest?.url);
  const pullRequestContent =
    hasPullRequest && pullRequest ? (
      <>
        <Icon icon={GitPullRequest} size={15} />
        <span className={styles.prNumber}>{pullRequestLabel(pullRequest, t)}</span>
        {pullRequest.title && <span className={styles.prTitle}>{pullRequest.title}</span>}
        {pullRequestUrl && <Icon icon={ExternalLink} size={13} />}
      </>
    ) : null;
  const shortCommit = commit && commit.length > 12 ? commit.slice(0, 10) : commit;

  return (
    <div className={styles.codingScope}>
      {(hasPullRequest || branch || commit || date) && (
        <div className={styles.codingScopeMain}>
          {pullRequestContent &&
            (pullRequestUrl ? (
              <a
                className={styles.prChip}
                data-link={true}
                href={pullRequestUrl}
                rel="noreferrer"
                target="_blank"
                title={pullRequest?.title ?? pullRequestUrl}
              >
                {pullRequestContent}
              </a>
            ) : (
              <span className={styles.prChip} title={pullRequest?.title}>
                {pullRequestContent}
              </span>
            ))}
          {branch && (
            <span className={styles.branchChip} title={branch}>
              <Icon icon={GitBranch} size={15} />
              <code>{branch}</code>
            </span>
          )}
          {commit && (
            <span className={styles.commitChip} title={commit}>
              <Icon icon={GitCommit} size={14} />
              <code>{shortCommit}</code>
            </span>
          )}
          {date && (
            <span className={styles.scopeMetaItem}>
              <Icon icon={CalendarClock} size={13} />
              <span>{date}</span>
            </span>
          )}
        </div>
      )}

      {(surfaces?.length || entry) && (
        <div className={styles.scopeMetaRow}>
          {surfaces && surfaces.length > 0 && (
            <span className={styles.scopeMetaItem}>
              <Icon icon={Layers} size={13} />
              <span className={styles.surfaceList}>
                {surfaces.map((surface) => (
                  <span className={styles.surfaceChip} key={surface}>
                    {surface}
                  </span>
                ))}
              </span>
            </span>
          )}
          {entry && (
            <span className={styles.scopeMetaItem} title={entry}>
              <Icon icon={Terminal} size={13} />
              <code>{entry}</code>
            </span>
          )}
        </div>
      )}

      {focus && (
        <div className={styles.scopeFocus}>
          <Icon icon={Target} size={13} />
          <span>{focus}</span>
        </div>
      )}
    </div>
  );
});

CodingScopeCard.displayName = 'CodingScopeCard';

/**
 * The report detail pane. Renders the verdict hero, a sticky verdict-filter bar,
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
  const verifyRunId = explicitRunId ?? routeRunId ?? null;
  const { data, error, isLoading, mutate } = useVerifyReportBundle(verifyRunId);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const status = data?.run.status;
    if (!status || terminalRunStatuses.has(status)) return;
    const timer = window.setInterval(() => void mutate(), 5000);
    return () => window.clearInterval(timer);
  }, [data?.run.status, mutate]);

  const ordered = useMemo(() => {
    if (!data) return [];
    return [...data.results].sort(
      (a, b) => SEVERITY_RANK[checkVerdict(a)] - SEVERITY_RANK[checkVerdict(b)],
    );
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

  const counts = ordered.reduce(
    (acc, r) => {
      acc[checkVerdict(r)] += 1;
      return acc;
    },
    { failed: 0, passed: 0, uncertain: 0 } as Record<Verdict, number>,
  );
  const total = report?.totalChecks ?? ordered.length;
  const passed = report?.passedChecks ?? counts.passed;
  const failed = report?.failedChecks ?? counts.failed;
  const uncertain = report?.uncertainChecks ?? counts.uncertain;
  const verdict = (report?.verdict as Verdict | null) ?? null;
  const visible = filter === 'all' ? ordered : ordered.filter((r) => checkVerdict(r) === filter);
  const isCodingReport = run.scenario === 'coding';
  const interactionCost = readInteractionCost(run.metadata);

  const chips: { count: number; dot?: string; key: Filter; label: string }[] = [
    { count: total, key: 'all', label: t('report.filter.all') },
    { count: failed, dot: cssVar.colorError, key: 'failed', label: t('report.filter.failed') },
    {
      count: uncertain,
      dot: cssVar.colorWarning,
      key: 'uncertain',
      label: t('report.filter.uncertain'),
    },
    { count: passed, dot: cssVar.colorSuccess, key: 'passed', label: t('report.filter.passed') },
  ];

  return (
    <div className={styles.scroll}>
      <div className={styles.page}>
        <main>
          <Flexbox gap={12}>
            <div className={styles.heroLine}>
              {verdict && (
                <span
                  className={styles.pill}
                  style={{
                    background: VERDICT_META[verdict].bg,
                    color: VERDICT_META[verdict].color,
                  }}
                >
                  <Icon icon={VERDICT_META[verdict].icon} size={15} />
                  {t(`report.verdict.${verdict}`)}
                </span>
              )}
              <Text as={'h1'} style={{ fontSize: 24, lineHeight: 1.3, margin: 0 }}>
                {run.title || t('report.titleFallback')}
              </Text>
            </div>

            {!isCodingReport && run.goal && <Text className={styles.summary}>{run.goal}</Text>}
            {report?.summary && <Text className={styles.summary}>{report.summary}</Text>}

            {isCodingReport && <CodingScopeCard context={run.context} />}

            {liveStatus && (
              <div className={styles.liveBanner}>
                <Icon icon={Clock3} size={14} />
                {t(liveStatusLabelKey[liveStatus])}
              </div>
            )}
          </Flexbox>

          <div className={styles.stats}>
            {chips.map((c) => (
              <button
                className={styles.chip}
                data-active={filter === c.key}
                key={c.key}
                type={'button'}
                onClick={() => setFilter(c.key)}
              >
                {c.dot && <span className={styles.dot} style={{ background: c.dot }} />}
                {c.label} <b>{c.count}</b>
              </button>
            ))}
            {typeof report?.overallConfidence === 'number' && (
              <span className={`${styles.chip} ${styles.score}`}>
                {t('report.stats.confidence')} <b>{Math.round(report.overallConfidence * 100)}%</b>
              </span>
            )}
          </div>

          {visible.length > 0 ? (
            <div className={styles.checks}>
              {visible.map((r) => (
                <CheckRow
                  key={r.id}
                  result={r}
                  defaultOpen={
                    checkVerdict(r) === 'failed' || r.evidence.some(isInlineVisualEvidence)
                  }
                />
              ))}
            </div>
          ) : (
            <Block align={'center'} padding={24}>
              <Text type={'secondary'}>{t('report.filterEmpty')}</Text>
            </Block>
          )}

          {report?.content && (
            <details className={styles.narrative}>
              <summary className={styles.narrativeSummary}>
                <Icon icon={ChevronRight} size={13} />
                {t('report.sections.details')}
              </summary>
              <div className={styles.narrativeBody}>
                <Markdown>{report.content}</Markdown>
              </div>
            </details>
          )}

          {interactionCost && (
            <details className={styles.narrative}>
              <summary className={styles.narrativeSummary}>
                <Icon icon={ChevronRight} size={13} />
                {t('report.interaction.title')}
              </summary>
              <div className={styles.interactionCostBody}>
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
