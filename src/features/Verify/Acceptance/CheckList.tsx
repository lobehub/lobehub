'use client';

import { ActionIcon, Flexbox, Icon, Image, Tag, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  CheckCircle2,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDashed,
  FileText,
  Film,
  HelpCircle,
  Images,
  Repeat,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Fragment, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceBundle } from '@/services/verify';

export type AcceptanceCheck = AcceptanceBundle['checks'][number];
export type AcceptanceCheckState = AcceptanceCheck['state'];
type AcceptanceEvidence = AcceptanceCheck['evidence'][number];

/** Unresolved-first ordering — exceptions are what the decision hinges on. */
const SEVERITY: Record<AcceptanceCheckState, number> = {
  failed: 0,
  not_executed: 2,
  passed: 3,
  uncertain: 1,
};

const STATE_META: Record<AcceptanceCheckState, { color: string; icon: typeof CheckCircle2 }> = {
  failed: { color: cssVar.colorError, icon: XCircle },
  not_executed: { color: cssVar.colorTextQuaternary, icon: CircleDashed },
  passed: { color: cssVar.colorSuccess, icon: CheckCircle2 },
  uncertain: { color: cssVar.colorWarning, icon: HelpCircle },
};

export const isException = (check: AcceptanceCheck) =>
  check.state === 'failed' || check.state === 'uncertain';

const VISUAL_EVIDENCE = new Set(['gif', 'screenshot', 'video']);

const isVisual = (item: AcceptanceEvidence) =>
  Boolean(item.fileUrl) && VISUAL_EVIDENCE.has(item.type);

export const hasVisualEvidence = (check: AcceptanceCheck) => check.evidence.some(isVisual);

const styles = createStaticStyles(({ css }) => ({
  caption: css`
    align-self: center;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  chip: css`
    padding-inline: 6px;
    border-radius: 4px;

    font-size: 11px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  chipClickable: css`
    cursor: pointer;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  descClamp: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  `,
  evidenceImage: css`
    overflow: hidden;

    width: fit-content;
    max-width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
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
  groupCard: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  groupHeader: css`
    cursor: pointer;
    padding-block: 10px;
    padding-inline: 16px;
    background: ${cssVar.colorFillQuaternary};
  `,
  historyToggle: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    width: fit-content;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  row: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  rowHeader: css`
    cursor: pointer;
    padding-block: 12px;
    padding-inline: 16px;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  stepDot: css`
    flex: none;

    width: 9px;
    height: 9px;
    margin-block-start: 5px;
    border: 2px solid;
    border-radius: 50%;

    background: ${cssVar.colorBgContainer};
  `,
  stepRail: css`
    flex: 1;
    width: 1px;
    margin-block-start: 6px;
    background: ${cssVar.colorBorderSecondary};
  `,
  titleEllipsis: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

/** Evidence media counts for the collapsed row's right-side badges. */
const evidenceCounts = (evidence: AcceptanceEvidence[]) => {
  const counts = { file: 0, image: 0, video: 0 };
  for (const item of evidence) {
    if (item.type === 'video' && item.fileUrl) counts.video += 1;
    else if (isVisual(item)) counts.image += 1;
    else counts.file += 1;
  }
  return counts;
};

const EVIDENCE_BADGES = [
  { icon: Images, key: 'image', labelKey: 'acceptance.evidence.image' },
  { icon: Film, key: 'video', labelKey: 'acceptance.evidence.video' },
  { icon: FileText, key: 'file', labelKey: 'acceptance.evidence.file' },
] as const;

/** A filename is not a caption — only descriptive text renders under the artifact. */
const isFilename = (value: string | null | undefined) =>
  !value || /^[\w.-]+\.(?:gif|jpe?g|mp4|png|webm|webp)$/i.test(value);

const EvidenceList = memo<{ evidence: AcceptanceEvidence[] }>(({ evidence }) => {
  const sorted = [...evidence].sort((a, b) => (isVisual(b) ? 1 : 0) - (isVisual(a) ? 1 : 0));
  if (sorted.length === 0) return null;

  return (
    <Flexbox gap={12}>
      {sorted.map((item) => {
        const caption = !isFilename(item.description) && (
          <span className={styles.caption}>{item.description}</span>
        );
        if (item.fileUrl && item.type === 'video')
          return (
            <Flexbox gap={4} key={item.id} style={{ maxWidth: '100%', width: 'fit-content' }}>
              <video
                controls
                src={item.fileUrl}
                style={{ borderRadius: 8, maxHeight: 360, maxWidth: '100%', width: 'auto' }}
              />
              {caption}
            </Flexbox>
          );
        if (item.fileUrl && VISUAL_EVIDENCE.has(item.type))
          return (
            <Flexbox gap={4} key={item.id} style={{ maxWidth: '100%', width: 'fit-content' }}>
              <Flexbox className={styles.evidenceImage}>
                <Image
                  alt={item.description ?? item.fileName ?? item.type}
                  loading={'lazy'}
                  src={item.fileUrl}
                  style={{ maxWidth: '100%' }}
                />
              </Flexbox>
              {caption}
            </Flexbox>
          );
        if (item.content)
          return (
            <Flexbox gap={4} key={item.id}>
              <div className={styles.evidenceText}>{item.content}</div>
              {caption}
            </Flexbox>
          );
        return null;
      })}
    </Flexbox>
  );
});

/**
 * The iteration-history timeline (newest first): each executed step's round,
 * the wording THAT round used, and its evidence — how the check evolved.
 */
const IterationTimeline = memo<{
  check: AcceptanceCheck;
  onRound: (round: number) => void;
}>(({ check, onRound }) => {
  const { t } = useTranslation('verify');
  const steps = [...check.timeline].reverse();

  return (
    <Flexbox>
      {steps.map((step, index) => {
        const isCurrent = index === 0;
        const isLast = index === steps.length - 1;
        const stateColor =
          {
            failed: cssVar.colorError,
            passed: cssVar.colorSuccess,
            uncertain: cssVar.colorWarning,
          }[step.state as string] ?? cssVar.colorTextQuaternary;

        return (
          <Flexbox horizontal gap={12} key={`${step.roundIndex}-${step.resultId}`}>
            <Flexbox align={'center'} style={{ flex: 'none', width: 9 }}>
              <span
                className={styles.stepDot}
                style={{
                  background: isCurrent ? stateColor : cssVar.colorBgContainer,
                  borderColor: isCurrent ? stateColor : cssVar.colorTextQuaternary,
                }}
              />
              {!isLast && <div className={styles.stepRail} />}
            </Flexbox>
            <Flexbox flex={1} gap={6} style={{ minWidth: 0, paddingBlockEnd: isLast ? 0 : 20 }}>
              <Tooltip title={t('acceptance.history.jump', { round: step.roundIndex })}>
                <Text
                  strong
                  style={{ cursor: 'pointer', fontSize: 12, lineHeight: '19px' }}
                  onClick={() => onRound(step.roundIndex)}
                >
                  {t('acceptance.round', { round: step.roundIndex })}
                </Text>
              </Tooltip>
              <Text style={{ fontSize: 12 }}>{step.title}</Text>
              {step.evidence.length > 0 && (
                <Flexbox horizontal gap={8} wrap={'wrap'}>
                  {step.evidence.map((item) =>
                    item.fileUrl && VISUAL_EVIDENCE.has(item.type) ? (
                      <Flexbox className={styles.evidenceImage} key={item.id}>
                        <Image
                          alt={item.description ?? item.type}
                          loading={'lazy'}
                          src={item.fileUrl}
                          style={{ maxHeight: 160, maxWidth: 280, width: 'auto' }}
                        />
                      </Flexbox>
                    ) : item.content ? (
                      <div
                        className={styles.evidenceText}
                        key={item.id}
                        style={{ maxHeight: 120, maxWidth: 420 }}
                      >
                        {item.content}
                      </div>
                    ) : null,
                  )}
                </Flexbox>
              )}
            </Flexbox>
          </Flexbox>
        );
      })}
      {check.result?.suggestion && (
        <Flexbox horizontal gap={12} style={{ marginBlockStart: 12 }}>
          <Text fontSize={12} style={{ flex: 'none', minWidth: 64 }} type={'secondary'}>
            {t('acceptance.detail.suggestion')}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {check.result.suggestion}
          </Text>
        </Flexbox>
      )}
    </Flexbox>
  );
});

const CheckRow = memo<{
  check: AcceptanceCheck;
  expanded: boolean;
  onRound: (round: number) => void;
  onToggle: () => void;
}>(({ check, expanded, onRound, onToggle }) => {
  const { t } = useTranslation('verify');
  // The judging narrative stays collapsed: level one is title + evidence.
  const [historyOpen, setHistoryOpen] = useState(false);
  const meta = STATE_META[check.state];
  const counts = evidenceCounts(check.evidence);

  return (
    <Flexbox className={styles.row}>
      <Flexbox horizontal align={'center'} className={styles.rowHeader} gap={10} onClick={onToggle}>
        <Icon color={meta.color} icon={meta.icon} size={16} />
        <Flexbox
          horizontal
          align={'center'}
          flex={1}
          gap={8}
          style={{ minWidth: 0 }}
          wrap={expanded ? 'wrap' : 'nowrap'}
        >
          <Text
            className={expanded ? undefined : styles.titleEllipsis}
            style={{ fontSize: 13, minWidth: 0 }}
          >
            {check.title}
          </Text>
          {!check.required && (
            <Tooltip title={t('acceptance.checks.notRequiredHint')}>
              <Tag size={'small'}>{t('acceptance.checks.notRequired')}</Tag>
            </Tooltip>
          )}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={6}>
          {EVIDENCE_BADGES.map(({ icon, key, labelKey }) =>
            counts[key] ? (
              <Tooltip key={key} title={t(labelKey, { count: counts[key] })}>
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={3}
                  style={{ color: cssVar.colorTextTertiary, fontSize: 11 }}
                >
                  <Icon icon={icon} size={13} />
                  {counts[key] > 1 ? counts[key] : null}
                </Flexbox>
              </Tooltip>
            ) : null,
          )}
          {check.revisions > 1 && (
            <Tooltip
              title={
                check.titleChanged
                  ? t('acceptance.checks.iteratedHint', { count: check.revisions })
                  : t('acceptance.checks.rerunHint', { count: check.revisions })
              }
            >
              <span className={styles.chip}>
                <Icon icon={Repeat} size={10} />{' '}
                {check.titleChanged
                  ? t('acceptance.checks.iterated', { count: check.revisions })
                  : t('acceptance.checks.rerun', { count: check.revisions })}
              </span>
            </Tooltip>
          )}
          {check.fixed && (
            <Tooltip
              title={t('acceptance.checks.fixedHint', {
                fixedRound: check.resultRound,
                round: check.introducedAtRound,
              })}
            >
              <span className={styles.chip}>
                <Icon icon={Wrench} size={10} /> {t('acceptance.checks.fixed')}
              </span>
            </Tooltip>
          )}
          {check.resultRound !== undefined &&
            check.resultRound !== null &&
            check.introducedAtRound !== check.resultRound && (
              <Tooltip title={t('acceptance.checks.introducedHint')}>
                <span
                  className={cx(styles.chip, styles.chipClickable)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRound(check.introducedAtRound);
                  }}
                >
                  {t('acceptance.checks.introduced', { round: check.introducedAtRound })}
                </span>
              </Tooltip>
            )}
          {check.resultRound !== undefined && check.resultRound !== null && (
            <Tooltip title={t('acceptance.checks.finalRoundHint')}>
              <span
                className={cx(styles.chip, styles.chipClickable)}
                onClick={(event) => {
                  event.stopPropagation();
                  onRound(check.resultRound!);
                }}
              >
                {t('acceptance.round', { round: check.resultRound })}
              </span>
            </Tooltip>
          )}
          <Icon
            color={cssVar.colorTextQuaternary}
            icon={ChevronRight}
            size={14}
            style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
          />
        </Flexbox>
      </Flexbox>

      {expanded && (
        <Flexbox gap={10} paddingBlock={'0 14px'} paddingInline={16}>
          {check.result?.toulmin?.evidence && (
            <Text className={styles.descClamp} fontSize={12} type={'secondary'}>
              {check.result.toulmin.evidence}
            </Text>
          )}
          <EvidenceList evidence={check.evidence} />

          {check.revisions > 1 && (
            <span className={styles.historyToggle} onClick={() => setHistoryOpen((open) => !open)}>
              <Icon
                icon={ChevronRight}
                size={12}
                style={{
                  transform: historyOpen ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              />
              {t('acceptance.checks.iterationHistory', { count: check.revisions })}
            </span>
          )}
          {historyOpen && check.revisions > 1 && (
            <IterationTimeline check={check} onRound={onRound} />
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export type CheckFilter = 'all' | 'exception' | 'fixed';

interface CheckGroup {
  checks: AcceptanceCheck[];
  key: string;
  label: string;
}

/**
 * Group by the harness-authored `category`, falling back to the product
 * surface, then a catch-all — familiar sections over storage taxonomy (P-14).
 */
export const groupChecks = (
  checks: AcceptanceCheck[],
  surfaceLabel: (surface: NonNullable<AcceptanceCheck['surface']>) => string,
  otherLabel: string,
): CheckGroup[] => {
  const groups = new Map<string, CheckGroup>();
  for (const check of checks) {
    const key = check.category ?? (check.surface ? `surface:${check.surface}` : 'other');
    const label = check.category ?? (check.surface ? surfaceLabel(check.surface) : otherLabel);
    const group = groups.get(key) ?? { checks: [], key, label };
    group.checks.push(check);
    groups.set(key, group);
  }
  return [...groups.values()];
};

interface CheckListProps {
  checks: AcceptanceCheck[];
  collapsedGroups: Set<string>;
  expanded: Set<string>;
  filter: CheckFilter;
  onRound: (round: number) => void;
  onToggleGroup: (key: string) => void;
  onToggleGroupItems: (ids: string[], open: boolean) => void;
  onToggleItem: (id: string) => void;
}

/** The union check list: one joined card, collapsible business groups. */
const CheckList = memo<CheckListProps>(
  ({
    checks,
    collapsedGroups,
    expanded,
    filter,
    onRound,
    onToggleGroup,
    onToggleGroupItems,
    onToggleItem,
  }) => {
    const { t } = useTranslation('verify');

    const visible = (check: AcceptanceCheck) => {
      if (filter === 'exception') return isException(check);
      if (filter === 'fixed') return check.fixed;
      return true;
    };

    const groups = groupChecks(
      checks,
      (surface) => t(`report.surface.${surface}`),
      t('acceptance.surface.other'),
    )
      .map((group) => ({
        ...group,
        rows: group.checks
          .filter(visible)
          .sort(
            (a, b) =>
              SEVERITY[a.state] - SEVERITY[b.state] ||
              (hasVisualEvidence(b) ? 1 : 0) - (hasVisualEvidence(a) ? 1 : 0) ||
              a.introducedAtRound - b.introducedAtRound,
          ),
      }))
      .filter((group) => group.rows.length > 0);

    return (
      <Flexbox className={styles.groupCard}>
        {groups.map(({ checks: groupChecks_, key, label, rows }, groupIndex) => {
          const passed = groupChecks_.filter((check) => check.state === 'passed').length;
          const collapsed = collapsedGroups.has(key);
          const anyItemOpen = rows.some((check) => expanded.has(check.id));

          return (
            <Fragment key={key}>
              <Flexbox
                horizontal
                align={'center'}
                className={styles.groupHeader}
                gap={8}
                style={{
                  borderBlockStart:
                    groupIndex > 0 ? `1px solid ${cssVar.colorBorderSecondary}` : 'none',
                }}
                onClick={() => onToggleGroup(key)}
              >
                <Text strong style={{ fontSize: 13 }}>
                  {label}
                </Text>
                <Text fontSize={12} type={'secondary'}>
                  {t('acceptance.group.passRatio', { passed, total: groupChecks_.length })}
                </Text>
                <Flexbox flex={1} />
                {collapsed ? (
                  // Fixed-size placeholder keeps the header height stable across toggles.
                  <div style={{ height: 24, width: 24 }} />
                ) : (
                  <ActionIcon
                    icon={anyItemOpen ? ChevronsDownUp : ChevronsUpDown}
                    size={'small'}
                    title={
                      anyItemOpen
                        ? t('acceptance.group.collapseItems')
                        : t('acceptance.group.expandItems')
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleGroupItems(
                        rows.map((check) => check.id),
                        !anyItemOpen,
                      );
                    }}
                  />
                )}
                <Icon
                  color={cssVar.colorTextQuaternary}
                  icon={ChevronRight}
                  size={14}
                  style={{
                    transform: collapsed ? 'none' : 'rotate(90deg)',
                    transition: 'transform 0.2s',
                  }}
                />
              </Flexbox>
              {!collapsed &&
                rows.map((check) => (
                  <CheckRow
                    check={check}
                    expanded={expanded.has(check.id)}
                    key={check.id}
                    onRound={onRound}
                    onToggle={() => onToggleItem(check.id)}
                  />
                ))}
            </Fragment>
          );
        })}
      </Flexbox>
    );
  },
);

CheckList.displayName = 'AcceptanceCheckList';

export default CheckList;
