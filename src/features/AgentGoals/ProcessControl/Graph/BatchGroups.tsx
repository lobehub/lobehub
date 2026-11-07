'use client';

import type { GoalRolloutPlanSkill, GoalRolloutRetro, GoalRolloutVerifier } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  createStaticStyles,
  cssVar,
  cx,
  Flexbox,
  Icon,
  Tooltip,
} from '@lobehub/ui';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  HandIcon,
  Info,
  type LucideIcon,
  NotebookPen,
  ShieldCheck,
  TestTubeDiagonal,
  TriangleAlert,
  Waves,
} from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import RunningGlyph from '@/features/Home/components/RunningGlyph';

import type { GoalNodeView } from '../goalGraphViewModel';
import { GATE_COLOR, KIND_COLOR, KIND_ICON, SKILL_COLOR, SKILL_ICON } from '../shared';
import {
  BATCH_FRAME_HEAD,
  BATCH_RETRO_MARK,
  BATCH_RETRO_ROW,
  BATCH_ROW_LABEL,
  BATCH_SQUARE,
  BATCH_SQUARE_GAP,
} from './batchLayout';
import {
  type BatchCell,
  type BatchCellState,
  type BatchProbe,
  type BatchUnitOrigin,
  countCells,
  reopenedRows,
} from './batchModel';

/**
 * The expanded batch, drawn the way it is followed and with no frame of its
 * own: the first round's trials (an experiment probe) as task cards, the roster as waves of squares, and a
 * small re-dispatch group per re-opened round. Squares carry the canonical
 * execution states — grey not run, amber running (glowing square), blue needs a
 * person, green done, faded superseded.
 */

/**
 * Done is the design-system green at full strength: `green9` is `#379d4a` in
 * light and `#62c473` in dark. `colorSuccess` turns lime on dark, and the
 * softer `green10` the finding kind uses reads washed out on a small square.
 */
const DONE_COLOR = cssVar.green9;

export const CELL_VISUAL: Record<BatchCellState, { color: string; icon: LucideIcon }> = {
  backlog: { color: TASK_STATUS_VISUALS.backlog.color, icon: CircleDashed },
  done: { color: DONE_COLOR, icon: CircleCheck },
  human: { color: TASK_STATUS_VISUALS.paused.color, icon: HandIcon },
  running: { color: TASK_STATUS_VISUALS.running.color, icon: CircleDot },
  stale: { color: TASK_STATUS_VISUALS.backlog.color, icon: CircleSlash },
};

const styles = createStaticStyles(({ css }) => ({
  glow: css`
    animation: goal-batch-glow 1.6s ease-in-out infinite;

    @keyframes goal-batch-glow {
      0%,
      100% {
        box-shadow: 0 0 0 0 color-mix(in srgb, ${cssVar.colorWarning} 0%, transparent);
      }

      50% {
        box-shadow:
          0 0 0 2px color-mix(in srgb, ${cssVar.colorWarning} 28%, transparent),
          0 0 8px 2px color-mix(in srgb, ${cssVar.colorWarning} 55%, transparent);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
  card: css`
    cursor: pointer;

    box-sizing: border-box;
    width: 100%;
    padding-block: 7px;
    padding-inline: 9px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition: border-color 0.15s;

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  cardTitle: css`
    overflow: hidden;

    font-size: 12px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  foot: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 10px;

    font-size: 11px;
  `,
  glyph: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 6px;
  `,
  group: css`
    box-sizing: border-box;
    width: 100%;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 12px;

    /* White on light like every card; the header rule separates it, not a grey fill. */
    background: ${cssVar.colorBgContainer};
  `,
  /* A label row, not a title bar: no fill, no rule, the body carries the weight. */
  groupHead: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 8px;
    padding-inline: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px 12px 0 0;

    background: ${cssVar.colorBgContainer};
  `,
  groupTitle: css`
    overflow: hidden;

    min-width: 0;

    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  /* Trials: one row of two cards, status above each card. */
  probeGrid: css`
    display: flex;
    flex-wrap: wrap;
    gap: 7px;

    padding-block: 8px 4px;
    padding-inline: 10px;
  `,
  probeCell: css`
    display: flex;
    flex: 1 1 calc(50% - 4px);
    flex-direction: column;
    gap: 4px;

    min-width: 0;
  `,
  /* A round's frame: a quiet container, the cards inside carry the weight. */
  frame: css`
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: 16px;

    background: ${cssVar.colorFillQuaternary};
  `,
  frameHead: css`
    display: flex;
    align-items: center;

    height: ${BATCH_FRAME_HEAD}px;
    padding-inline: 14px;

    font-size: 13px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
  `,
  /* Waves: row gap equals square gap, so the roster reads as a grid. */
  wavesBody: css`
    display: flex;
    flex-direction: column;
    gap: ${BATCH_SQUARE_GAP}px;

    padding-block: 8px 4px;
    padding-inline: 10px;
  `,
  hint: css`
    cursor: help;
    display: inline-flex;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  handle: css`
    width: 1px;
    min-width: 0;
    height: 1px;
    min-height: 0;
    border: none;

    opacity: 0;
  `,
  muted: css`
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  retroMark: css`
    display: inline-flex;
    flex: none;
    gap: 4px;
    align-items: center;

    width: ${BATCH_RETRO_MARK}px;
    margin-inline-start: 4px;
    padding-inline-start: 8px;
    border-inline-start: 1px dashed ${cssVar.colorBorder};

    font-size: 10px;
    line-height: 1;
    white-space: nowrap;
  `,
  retroBody: css`
    display: flex;
    flex-direction: column;
    gap: 6px;

    padding-block: 8px 10px;
    padding-inline: 10px;
  `,
  retroLayer: css`
    /* A short row: the card radius would read as a pill. */
    border-radius: ${cssVar.borderRadiusSM};
  `,
  retroRow: css`
    cursor: default;
    height: ${BATCH_RETRO_ROW}px;

    &:hover {
      border-color: ${cssVar.colorBorderSecondary};
    }
  `,
  rowLabel: css`
    flex: none;

    width: ${BATCH_ROW_LABEL}px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    line-height: 1;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  rowLabelHot: css`
    font-weight: 700;
    color: ${cssVar.colorWarning};
  `,
  square: css`
    cursor: default;

    display: inline-block;
    flex: none;

    width: ${BATCH_SQUARE}px;
    height: ${BATCH_SQUARE}px;
    padding: 0;
    border: none;
    border-radius: 3px;
  `,
  squareLink: css`
    cursor: pointer;
  `,
  status: css`
    display: inline-flex;
    gap: 5px;
    align-items: center;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
  `,
}));

const squareStyle = (state: BatchCellState) => {
  switch (state) {
    case 'human': {
      return {
        background: CELL_VISUAL.human.color,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${CELL_VISUAL.human.color} 22%, transparent)`,
      };
    }
    case 'stale': {
      return { background: cssVar.colorTextQuaternary, opacity: 0.38 };
    }
    default: {
      return { background: CELL_VISUAL[state].color };
    }
  }
};

/**
 * Stages sit top-aligned in one row but differ in height, so their side
 * handles share one height from the top — the hand-off lines stay straight.
 */
const STAGE_HANDLE_TOP = 19;

/**
 * Groups link like any card on the map — in at the top, out at the bottom — and
 * a waves group can also hand a re-opened round off to the side (`r`).
 */
const GroupHandles = () => (
  <>
    <Handle className={styles.handle} isConnectable={false} position={Position.Top} type="target" />
    {/* Stages hand off left to right: in on the left, out on the right. */}
    <Handle
      className={styles.handle}
      id="l"
      isConnectable={false}
      position={Position.Left}
      style={{ top: STAGE_HANDLE_TOP }}
      type="target"
    />
    {/* Bottom first: a link that names no handle takes the first source. */}
    <Handle
      className={styles.handle}
      isConnectable={false}
      position={Position.Bottom}
      type="source"
    />
    <Handle
      className={styles.handle}
      id="r"
      isConnectable={false}
      position={Position.Right}
      style={{ top: STAGE_HANDLE_TOP }}
      type="source"
    />
  </>
);

interface GroupStatus {
  color: string;
  icon: LucideIcon;
  /** Live work swaps the static glyph for the shared spinning ring. */
  running?: boolean;
  text: string;
}

const StatusText = memo<GroupStatus>(({ color, icon, running, text }) => (
  <span className={styles.status} style={{ color }}>
    {running ? <RunningGlyph size={13} /> : <Icon icon={icon} size={13} />}
    {text}
  </span>
));

StatusText.displayName = 'GoalBatchStatusText';

const GroupShell = memo<{
  children: ReactNode;
  foot?: string;
  /** Detail behind an info icon beside the title. */
  hint?: ReactNode;
  icon: LucideIcon;
  iconColor: string;
  onEnter?: () => void;
  status: GroupStatus;
  /** Status (and foot) in the head's right corner, with no foot row of its own. */
  statusInHead?: boolean;
  title: string;
  /** A control that belongs in the head, before the enter button. */
  toolbar?: ReactNode;
}>(({ children, foot, hint, icon, iconColor, onEnter, status, statusInHead, title, toolbar }) => {
  const { t } = useTranslation('chat');
  return (
    <div className={styles.group}>
      <GroupHandles />
      <div className={styles.groupHead}>
        <Flexbox horizontal align={'center'} gap={7} style={{ minWidth: 0, overflow: 'hidden' }}>
          <Icon color={iconColor} icon={icon} size={14} />
          <span className={styles.groupTitle}>{title}</span>
          {hint && (
            <Tooltip title={hint}>
              <span data-hint className={cx('nodrag', styles.hint)} role="img">
                <Icon icon={Info} size={13} />
              </span>
            </Tooltip>
          )}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
          {statusInHead && (
            <>
              <StatusText {...status} />
              {foot && <span className={styles.muted}>{foot}</span>}
            </>
          )}
          {toolbar}
          {onEnter && (
            <Button
              className={'nodrag'}
              size={'small'}
              onClick={(event) => {
                event.stopPropagation();
                onEnter();
              }}
            >
              {t('goalBatch.enter')}
            </Button>
          )}
        </Flexbox>
      </div>
      {children}
      {!statusInHead && (
        <div className={styles.foot}>
          <StatusText {...status} />
          {foot && <span className={styles.muted}>{foot}</span>}
        </div>
      )}
    </div>
  );
});

GroupShell.displayName = 'GoalBatchGroupShell';

export const Square = memo<{
  onSelect?: (nodeId: string) => void;
  nodeId?: string;
  state: BatchCellState;
  tooltip: string;
}>(({ nodeId, onSelect, state, tooltip }) => (
  <Tooltip title={tooltip}>
    <button
      aria-label={tooltip}
      data-state={state}
      style={squareStyle(state)}
      type="button"
      className={cx(
        'nodrag',
        styles.square,
        nodeId && onSelect && styles.squareLink,
        state === 'running' && styles.glow,
      )}
      onClick={(event) => {
        event.stopPropagation();
        if (nodeId) onSelect?.(nodeId);
      }}
    />
  </Tooltip>
));

Square.displayName = 'GoalBatchSquare';

const useCellLabel = () => {
  const { t } = useTranslation('chat');
  return (state: BatchCellState) => t(`goalBatch.cell.${state}` as const);
};

/** One group status from its units: a person first, then progress. */
const useUnitsStatus = () => {
  const { t } = useTranslation('chat');
  return (
    cells: { state: BatchCellState }[],
    copy: { done: string; pending: string; running: string },
    started: boolean,
  ): GroupStatus => {
    const counts = countCells(cells);
    if (counts.human)
      return { ...CELL_VISUAL.human, text: t('goalBatch.status.human', { count: counts.human }) };
    if (counts.stale && counts.stale + counts.done < cells.length)
      return {
        color: cssVar.colorWarning,
        icon: CircleSlash,
        text: t('goalBatch.status.stale', { count: counts.stale }),
      };
    if (cells.length > 0 && counts.done + counts.stale === cells.length)
      return { ...CELL_VISUAL.done, text: copy.done };
    if (!started && !counts.running) return { ...CELL_VISUAL.backlog, text: copy.pending };
    return { ...CELL_VISUAL.running, running: true, text: copy.running };
  };
};

/**
 * What each square's colour means. It only matters where squares are drawn, so
 * it lives behind the info icon of the groups that draw them.
 */
const SquareLegend = memo(() => {
  const label = useCellLabel();
  return (
    <Flexbox gap={6}>
      {(['backlog', 'running', 'human', 'done', 'stale'] as const).map((state) => (
        <Flexbox horizontal align={'center'} gap={6} key={state}>
          <span className={styles.square} style={squareStyle(state)} />
          {label(state)}
        </Flexbox>
      ))}
    </Flexbox>
  );
});

SquareLegend.displayName = 'GoalBatchSquareLegend';

// ─── Experiment probe (the first round's trials) ──────────────────────────────────────────────

export interface BatchExperimentProbeData extends Record<string, unknown> {
  /** Open the batch on its own, the way a person reviews one batch at a time. */
  onEnter: () => void;
  onSelect: (nodeId: string) => void;
  probes: BatchProbe[];
  started: boolean;
  views: Record<string, GoalNodeView>;
}

/** Heads the unit's own brief in a re-run's description, after the shared plan. */
const CARRIED_BRIEF_HEADING = 'Unit brief (from its first run):';

/**
 * A probe's one-line subtitle: its own brief. A re-run's description opens with
 * the shared plan, so its subtitle is the brief it carried over from its first run.
 */
const probeSubtitle = (description?: string | null) => {
  if (!description) return '';
  const carried = description.indexOf(CARRIED_BRIEF_HEADING);
  const own =
    carried >= 0 ? description.slice(carried + CARRIED_BRIEF_HEADING.length) : description;
  return own.trim().split('\n')[0] ?? '';
};

const ProbeCell = memo<{ onSelect: (id: string) => void; probe: BatchProbe; view?: GoalNodeView }>(
  ({ onSelect, probe, view }) => {
    const { t } = useTranslation('chat');
    const visual = CELL_VISUAL[probe.state];
    const subtitle = probeSubtitle(view?.node.description);
    return (
      <div className={styles.probeCell} data-probe={probe.nodeId} data-state={probe.state}>
        <StatusText
          color={visual.color}
          icon={visual.icon}
          running={probe.state === 'running'}
          text={t(`goalBatch.probes.cell.${probe.state}` as const)}
        />
        <div
          className={cx('nodrag', styles.card)}
          role="button"
          style={probe.state === 'stale' ? { opacity: 0.5 } : undefined}
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(probe.nodeId);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(probe.nodeId);
            }
          }}
        >
          <Flexbox horizontal align={'center'} gap={7}>
            <span
              className={styles.glyph}
              style={{ background: KIND_COLOR.task.soft, color: KIND_COLOR.task.line }}
            >
              <Icon icon={KIND_ICON.task} size={14} />
            </span>
            <Flexbox style={{ flex: 1, minWidth: 0 }}>
              <span className={styles.cardTitle} title={probe.title}>
                {probe.title}
              </span>
              {subtitle && (
                <span className={cx(styles.cardTitle, styles.muted)} style={{ fontWeight: 400 }}>
                  {subtitle}
                </span>
              )}
            </Flexbox>
          </Flexbox>
        </div>
      </div>
    );
  },
);

ProbeCell.displayName = 'GoalBatchProbeCell';

export const BatchExperimentProbeGroup = memo<NodeProps>(({ data }) => {
  const { onEnter, onSelect, probes: latest, started, views } = data as BatchExperimentProbeData;
  const { t } = useTranslation('chat');
  // Trials sent back and run again in the round: one switch in the head picks
  // which run the cards show, the latest unless the reader goes back.
  const attempts = Math.max(1, ...latest.map((probe) => probe.attempt ?? 1));
  const [picked, setPicked] = useState<number>();
  const attempt = picked && picked <= attempts ? picked : attempts;
  const probes =
    attempt === attempts
      ? latest
      : latest.map((probe) => {
          const run = probe.runs?.[attempt - 1];
          return run ? { ...probe, ...run } : probe;
        });
  const status = useUnitsStatus()(
    probes,
    {
      done: t('goalBatch.probes.status.done'),
      pending: t('goalBatch.probes.status.pending'),
      running: t('goalBatch.probes.status.running'),
    },
    started,
  );
  return (
    <GroupShell
      hint={t('goalBatch.probes.hint', { count: probes.length })}
      icon={TestTubeDiagonal}
      iconColor={KIND_COLOR.batch.line}
      status={status}
      title={t('goalBatch.probes.title')}
      toolbar={
        attempts > 1 && (
          // A plan can be sent back many times before it passes: step through
          // the runs one at a time rather than listing every one of them.
          <Flexbox horizontal align={'center'} className={'nodrag'} gap={2}>
            <ActionIcon
              aria-label={t('goalBatch.probes.attemptPrevious')}
              disabled={attempt <= 1}
              icon={ChevronLeft}
              size={'small'}
              title={t('goalBatch.probes.attemptPrevious')}
              onClick={(event) => {
                event.stopPropagation();
                setPicked(attempt - 1);
              }}
            />
            <span className={styles.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {t('goalBatch.probes.attemptOf', { current: attempt, total: attempts })}
            </span>
            <ActionIcon
              aria-label={t('goalBatch.probes.attemptNext')}
              disabled={attempt >= attempts}
              icon={ChevronRight}
              size={'small'}
              title={t('goalBatch.probes.attemptNext')}
              onClick={(event) => {
                event.stopPropagation();
                setPicked(attempt + 1);
              }}
            />
          </Flexbox>
        )
      }
      onEnter={onEnter}
    >
      <div className={styles.probeGrid}>
        {probes.map((probe) => (
          <ProbeCell
            key={probe.nodeId}
            probe={probe}
            view={views[probe.nodeId]}
            onSelect={onSelect}
          />
        ))}
      </div>
    </GroupShell>
  );
});

BatchExperimentProbeGroup.displayName = 'GoalBatchExperimentProbeGroup';

// ─── Waves (the roster) ───────────────────────────────────────────────────

/** A roster wave as a row of squares; `wave` is its 0-based roster position. */
export interface BatchWaveRow {
  cells: BatchCell[];
  wave: number;
}

/**
 * The mark after a wave's squares: the retro that read it. Each execution
 * ends in one — experience into the plan, criteria into the verifier — so a
 * wave that finished without one says it still owes it.
 */
const RetroMark = memo<{ cells: BatchCell[]; retro?: GoalRolloutRetro }>(({ cells, retro }) => {
  const { t } = useTranslation('chat');
  const finished = cells.length > 0 && cells.every((cell) => cell.state === 'done');
  if (!retro && !finished) return <span className={styles.retroMark} />;
  const status = !retro
    ? { ...CELL_VISUAL.backlog, text: t('goalBatch.retro.mark.pending') }
    : retro.status === 'running'
      ? { ...CELL_VISUAL.running, running: true, text: t('goalBatch.retro.mark.running') }
      : retro.status === 'blocked'
        ? { color: cssVar.colorError, icon: TriangleAlert, text: t('goalBatch.retro.mark.blocked') }
        : {
            ...CELL_VISUAL.done,
            text: t('goalBatch.retro.mark.done', {
              skill: retro.skillVersion,
              verifier: retro.verifierVersion,
            }),
          };
  return (
    <Tooltip title={retro ? <RetroSummary retro={retro} /> : t('goalBatch.retro.mark.pendingHint')}>
      <span className={cx('nodrag', styles.retroMark)} data-retro-mark={retro?.status ?? 'pending'}>
        <StatusText {...status} />
      </span>
    </Tooltip>
  );
});

RetroMark.displayName = 'GoalBatchRetroMark';

const WaveRows = memo<{
  onSelect: (nodeId: string) => void;
  /** The retro after each roster wave, when the batch runs them. */
  retros?: GoalRolloutRetro[];
  rows: BatchWaveRow[];
}>(({ onSelect, retros, rows }) => {
  const { t } = useTranslation('chat');
  const label = useCellLabel();
  return (
    <>
      {rows.map(({ cells, wave }) => {
        const hot = cells.some((cell) => cell.state === 'human' || cell.reopenedIn);
        return (
          <Flexbox horizontal align={'center'} data-wave={wave} gap={8} key={wave}>
            <span className={cx(styles.rowLabel, hot && styles.rowLabelHot)}>
              {t('goalBatch.waves.row', { number: wave + 1 })}
            </span>
            <Flexbox horizontal gap={BATCH_SQUARE_GAP}>
              {cells.map((cell) => (
                <Square
                  key={cell.index}
                  nodeId={cell.nodeId}
                  state={cell.state}
                  tooltip={[
                    t('goalBatch.cell.tooltip', {
                      index: cell.index + 1,
                      state: label(cell.state),
                      title: cell.title,
                      wave: wave + 1,
                    }),
                    cell.reopenedIn
                      ? t('goalBatch.cell.reopened', { revision: cell.reopenedIn })
                      : cell.runIn
                        ? t('goalBatch.cell.runIn', { revision: cell.runIn })
                        : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  onSelect={onSelect}
                />
              ))}
            </Flexbox>
            {retros && (
              <RetroMark cells={cells} retro={retros.find((retro) => retro.wave === wave + 1)} />
            )}
          </Flexbox>
        );
      })}
    </>
  );
});

WaveRows.displayName = 'GoalBatchWaveRows';

// ─── A round: its waves, and the frame its nodes sit in ─────────────────

const useOriginCopy = () => {
  const { t } = useTranslation('chat');
  return (from?: BatchUnitOrigin): string => {
    switch (from?.kind) {
      case 'wave': {
        return t('goalBatch.redispatch.fromWave', { index: from.index + 1, wave: from.wave + 1 });
      }
      case 'probe': {
        return t('goalBatch.redispatch.fromProbe', { index: from.index + 1 });
      }
      case 'round': {
        return t('goalBatch.redispatch.fromRound', { revision: from.revision });
      }
      default: {
        return '';
      }
    }
  };
};

export interface BatchWavesData extends Record<string, unknown> {
  /** Open the batch on its own, the way a person reviews one batch at a time. */
  onEnter: () => void;
  onSelect: (nodeId: string) => void;
  /** The units this round re-opened — its own canary (rounds after the first). */
  probes: BatchProbe[];
  /** The retro after each roster wave, when the batch runs them. */
  retros?: GoalRolloutRetro[];
  revision: number;
  /** The roster waves this round released, or still holds as the latest round. */
  rows: BatchWaveRow[];
  started: boolean;
  waveSize: number;
}

/** A round's waves: the units it re-opened, then the roster waves it owns. */
export const BatchWavesGroup = memo<NodeProps>(({ data }) => {
  const { onEnter, onSelect, probes, retros, revision, rows, started, waveSize } =
    data as BatchWavesData;
  const { t } = useTranslation('chat');
  const label = useCellLabel();
  const originCopy = useOriginCopy();
  const rowLabelOf = (from?: BatchUnitOrigin) =>
    from?.kind === 'wave'
      ? t('goalBatch.waves.row', { number: from.wave + 1 })
      : from?.kind === 'probe'
        ? t('goalBatch.probes.rowLabel')
        : from?.kind === 'round'
          ? t('goalBatch.redispatch.labelRound', { revision: from.revision })
          : t('goalBatch.redispatch.reopenedRow');
  const reopened = revision > 1 ? reopenedRows(probes, waveSize) : [];
  const cells = [...(revision > 1 ? probes : []), ...rows.flatMap((row) => row.cells)];
  const status = useUnitsStatus()(
    cells,
    {
      done: t('goalBatch.status.done'),
      pending: t('goalBatch.status.pending'),
      running: t('goalBatch.status.running'),
    },
    started,
  );
  return (
    <GroupShell
      hint={<SquareLegend />}
      icon={Waves}
      iconColor={KIND_COLOR.task.line}
      status={status}
      foot={
        revision > 1
          ? t('goalBatch.redispatch.foot', { count: cells.length, revision })
          : t('goalBatch.waves.foot', { count: cells.length, waves: rows.length })
      }
      title={
        revision > 1 ? t('goalBatch.redispatch.title', { revision }) : t('goalBatch.waves.title')
      }
      onEnter={onEnter}
    >
      <div className={styles.wavesBody}>
        {/* Re-opened units first — this round's own canary, named by the batch
            they first ran in — then the roster waves the round owns. */}
        {reopened.map((row, w) => (
          <Flexbox horizontal align={'center'} data-reopened-row={w} gap={8} key={`reopened-${w}`}>
            <span className={styles.rowLabel}>{rowLabelOf(row.from)}</span>
            <Flexbox horizontal gap={BATCH_SQUARE_GAP}>
              {row.probes.map((probe) => (
                <Square
                  key={probe.nodeId}
                  nodeId={probe.nodeId}
                  state={probe.state}
                  tooltip={[probe.title, originCopy(probe.from), label(probe.state)]
                    .filter(Boolean)
                    .join(' · ')}
                  onSelect={onSelect}
                />
              ))}
            </Flexbox>
          </Flexbox>
        ))}
        <WaveRows retros={retros} rows={rows} onSelect={onSelect} />
      </div>
    </GroupShell>
  );
});

BatchWavesGroup.displayName = 'GoalBatchWavesGroup';

// ─── Retro (what an execution taught, before the gate) ──────────────────

/** What one retro produced and what it checked, for a tooltip. */
const RetroSummary = memo<{ retro: GoalRolloutRetro }>(({ retro }) => {
  const { t } = useTranslation('chat');
  return (
    <Flexbox gap={4}>
      {retro.skillVersion !== undefined && (
        <span>
          {t('goalBatch.retro.summary.skill', {
            count: retro.skillChanges ?? 0,
            version: retro.skillVersion,
          })}
        </span>
      )}
      {retro.verifierVersion !== undefined && (
        <span>
          {t('goalBatch.retro.summary.verifier', {
            added: retro.verifierChanges?.added ?? 0,
            loosened: retro.verifierChanges?.loosened ?? 0,
            version: retro.verifierVersion,
          })}
        </span>
      )}
      {retro.interventions && (
        <span>{t('goalBatch.retro.summary.interventions', retro.interventions)}</span>
      )}
      {retro.reverify && <span>{t('goalBatch.retro.summary.reverify', retro.reverify)}</span>}
    </Flexbox>
  );
});

RetroSummary.displayName = 'GoalBatchRetroSummary';

const RetroLayer = memo<{
  color: { line: string; soft: string };
  icon: LucideIcon;
  onOpen?: () => void;
  subtitle: string;
  title: string;
}>(({ color, icon, onOpen, subtitle, title }) => (
  <div
    className={cx('nodrag', styles.card, styles.retroLayer, !onOpen && styles.retroRow)}
    role={onOpen ? 'button' : undefined}
    style={{ height: BATCH_RETRO_ROW }}
    tabIndex={onOpen ? 0 : undefined}
    onClick={(event) => {
      event.stopPropagation();
      onOpen?.();
    }}
    onKeyDown={(event) => {
      if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onOpen();
      }
    }}
  >
    <Flexbox horizontal align={'center'} gap={7}>
      <span className={styles.glyph} style={{ background: color.soft, color: color.line }}>
        <Icon icon={icon} size={14} />
      </span>
      <Flexbox style={{ flex: 1, minWidth: 0 }}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={cx(styles.cardTitle, styles.muted)} style={{ fontWeight: 400 }}>
          {subtitle}
        </span>
      </Flexbox>
    </Flexbox>
  </div>
));

RetroLayer.displayName = 'GoalBatchRetroLayer';

export interface BatchRetroData extends Record<string, unknown> {
  onSelect: (nodeId: string) => void;
  planSkill?: GoalRolloutPlanSkill;
  retro: GoalRolloutRetro;
  /** The plan node the experience layer opens. */
  templateId?: string;
  verifier?: GoalRolloutVerifier;
}

/**
 * The retro after the trials, ahead of the gate: two layers distilled from what
 * the trials ran into — experience into the plan skill every unit loads, and
 * criteria into the verifier every unit is judged on. The gate opens on it.
 */
export const BatchRetroGroup = memo<NodeProps>(({ data }) => {
  const { onSelect, planSkill, retro, templateId, verifier } = data as BatchRetroData;
  const { t } = useTranslation('chat');
  const status: GroupStatus =
    retro.status === 'running'
      ? { ...CELL_VISUAL.running, running: true, text: t('goalBatch.retro.status.running') }
      : retro.status === 'blocked'
        ? {
            color: cssVar.colorError,
            icon: TriangleAlert,
            text: t('goalBatch.retro.status.blocked'),
          }
        : { ...CELL_VISUAL.done, text: t('goalBatch.retro.status.done') };
  // Re-verifying the units is the gate's check; the retro answers for the interventions.
  const foot = retro.interventions
    ? t('goalBatch.retro.interventionsShort', retro.interventions)
    : undefined;
  const criteria = verifier?.criteria;
  return (
    <GroupShell
      statusInHead
      foot={foot}
      hint={t('goalBatch.retro.hint')}
      icon={NotebookPen}
      iconColor={GATE_COLOR.line}
      status={status}
      title={
        retro.wave === 0
          ? t('goalBatch.retro.title')
          : t('goalBatch.retro.titleWave', { wave: retro.wave })
      }
    >
      <div className={styles.retroBody}>
        <RetroLayer
          color={SKILL_COLOR}
          icon={SKILL_ICON}
          title={t('goalBatch.retro.skill', { version: retro.skillVersion ?? 1 })}
          subtitle={[
            planSkill && `user-skills:${planSkill.name}`,
            retro.skillChanges !== undefined &&
              t('goalBatch.retro.changes', { count: retro.skillChanges }),
          ]
            .filter(Boolean)
            .join(' · ')}
          onOpen={templateId ? () => onSelect(templateId) : undefined}
        />
        <RetroLayer
          color={{ line: cssVar.colorInfo, soft: cssVar.colorInfoBg }}
          icon={ShieldCheck}
          title={t('goalBatch.retro.verifier', { version: retro.verifierVersion ?? 1 })}
          subtitle={[
            criteria && t('goalBatch.retro.criteria', criteria),
            retro.verifierChanges?.added &&
              t('goalBatch.retro.added', { count: retro.verifierChanges.added }),
            retro.verifierChanges?.loosened &&
              t('goalBatch.retro.loosened', { count: retro.verifierChanges.loosened }),
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      </div>
    </GroupShell>
  );
});

BatchRetroGroup.displayName = 'GoalBatchRetroGroup';

export interface BatchRoundFrameData extends Record<string, unknown> {
  revision: number;
}

/**
 * The frame one round's nodes sit in — its plan, its gate and its waves. It is
 * only a container: no status and no entry of its own (the waves carry those).
 * It sits behind the links between its nodes, and links round to round on its
 * sides, level with its label.
 */
export const BatchRoundFrame = memo<NodeProps>(({ data }) => {
  const { revision } = data as BatchRoundFrameData;
  const { t } = useTranslation('chat');
  return (
    <div className={styles.frame}>
      <Handle
        className={styles.handle}
        id="l"
        isConnectable={false}
        position={Position.Left}
        style={{ top: BATCH_FRAME_HEAD / 2 }}
        type="target"
      />
      <Handle
        className={styles.handle}
        id="r"
        isConnectable={false}
        position={Position.Right}
        style={{ top: BATCH_FRAME_HEAD / 2 }}
        type="source"
      />
      <div className={styles.frameHead}>{t('goalBatch.round.title', { revision })}</div>
    </div>
  );
});

BatchRoundFrame.displayName = 'GoalBatchRoundFrame';
