'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  HandIcon,
  Info,
  type LucideIcon,
  TestTubeDiagonal,
  Waves,
} from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';

import type { GoalNodeView } from '../goalGraphViewModel';
import { KIND_COLOR, KIND_ICON } from '../shared';
import { BATCH_ROW_LABEL, BATCH_SQUARE, BATCH_SQUARE_GAP } from './batchLayout';
import {
  type BatchCell,
  type BatchCellState,
  type BatchProbe,
  type BatchUnitOrigin,
  countCells,
} from './batchModel';

/**
 * The expanded batch, drawn the way it is followed and with no frame of its
 * own: the first round's trials (an experiment probe) as task cards, the roster as waves of squares, and a
 * small re-dispatch group per re-opened round. Squares carry the canonical
 * execution states — grey not run, amber running (breathing), blue needs a
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
  breathe: css`
    animation: goal-batch-breathe 1.6s ease-in-out infinite;

    @keyframes goal-batch-breathe {
      0%,
      100% {
        transform: scale(1);
        opacity: 1;
      }

      50% {
        transform: scale(0.86);
        opacity: 0.42;
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
    font-size: 13px;
    font-weight: 600;
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
 * Groups link like any card on the map — in at the top, out at the bottom — and
 * a waves group can also hand a re-opened round off to the side (`r`).
 */
const GroupHandles = () => (
  <>
    <Handle className={styles.handle} isConnectable={false} position={Position.Top} type="target" />
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
      type="source"
    />
  </>
);

interface GroupStatus {
  color: string;
  icon: LucideIcon;
  text: string;
}

const StatusText = memo<GroupStatus & { breathe?: boolean }>(({ breathe, color, icon, text }) => (
  <span className={cx(styles.status, breathe && styles.breathe)} style={{ color }}>
    <Icon icon={icon} size={13} />
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
  title: string;
}>(({ children, foot, hint, icon, iconColor, onEnter, status, title }) => {
  const { t } = useTranslation('chat');
  return (
    <div className={styles.group}>
      <GroupHandles />
      <div className={styles.groupHead}>
        <Flexbox horizontal align={'center'} gap={7} style={{ minWidth: 0 }}>
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
      </div>
      {children}
      <div className={styles.foot}>
        <StatusText {...status} />
        {foot && <span className={styles.muted}>{foot}</span>}
      </div>
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
        state === 'running' && styles.breathe,
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
  ): GroupStatus & { breathe?: boolean } => {
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
    return { ...CELL_VISUAL.running, text: copy.running };
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

const ProbeCell = memo<{ onSelect: (id: string) => void; probe: BatchProbe; view?: GoalNodeView }>(
  ({ onSelect, probe, view }) => {
    const { t } = useTranslation('chat');
    const visual = CELL_VISUAL[probe.state];
    const subtitle = view?.node.description?.split('\n')[0] ?? '';
    return (
      <div className={styles.probeCell} data-probe={probe.nodeId} data-state={probe.state}>
        <StatusText
          breathe={probe.state === 'running'}
          color={visual.color}
          icon={visual.icon}
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
  const { onEnter, onSelect, probes, started, views } = data as BatchExperimentProbeData;
  const { t } = useTranslation('chat');
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

const WaveRows = memo<{ onSelect: (nodeId: string) => void; rows: BatchWaveRow[] }>(
  ({ onSelect, rows }) => {
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
            </Flexbox>
          );
        })}
      </>
    );
  },
);

WaveRows.displayName = 'GoalBatchWaveRows';

export interface BatchWavesData extends Record<string, unknown> {
  /** Open the batch on its own, the way a person reviews one batch at a time. */
  onEnter: () => void;
  onSelect: (nodeId: string) => void;
  /** The waves the first round released, or still holds. */
  rows: BatchWaveRow[];
  started: boolean;
}

export const BatchWavesGroup = memo<NodeProps>(({ data }) => {
  const { onEnter, onSelect, rows, started } = data as BatchWavesData;
  const { t } = useTranslation('chat');
  const cells = rows.flatMap((row) => row.cells);
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
      foot={t('goalBatch.waves.foot', { count: cells.length, waves: rows.length })}
      hint={<SquareLegend />}
      icon={Waves}
      iconColor={KIND_COLOR.task.line}
      status={status}
      title={t('goalBatch.waves.title')}
      onEnter={onEnter}
    >
      <div className={styles.wavesBody}>
        <WaveRows rows={rows} onSelect={onSelect} />
      </div>
    </GroupShell>
  );
});

BatchWavesGroup.displayName = 'GoalBatchWavesGroup';

// ─── A later round's waves ────────────────────────────────────────────────

export interface BatchRedispatchData extends Record<string, unknown> {
  /** Open the batch on its own, the way a person reviews one batch at a time. */
  onEnter: () => void;
  onSelect: (nodeId: string) => void;
  /** The units this round re-opened — its own canary. */
  probes: BatchProbe[];
  revision: number;
  /** The roster waves this round released, or still holds as the latest round. */
  rows: BatchWaveRow[];
  started: boolean;
  waveSize: number;
}

/** Where a re-opened unit ran before, for its square's tooltip. */
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

export const BatchRedispatchGroup = memo<NodeProps>(({ data }) => {
  const { onEnter, onSelect, probes, revision, rows, started, waveSize } =
    data as BatchRedispatchData;
  const { t } = useTranslation('chat');
  const label = useCellLabel();
  const originCopy = useOriginCopy();
  const cells = [...probes, ...rows.flatMap((row) => row.cells)];
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
      foot={t('goalBatch.redispatch.foot', { count: cells.length, revision })}
      hint={<SquareLegend />}
      icon={Waves}
      iconColor={KIND_COLOR.task.line}
      status={status}
      title={t('goalBatch.redispatch.title', { revision })}
      onEnter={onEnter}
    >
      {/* The re-opened units first — this round's own canary, capped at the
          wave size; where each came from is on hover. Then the roster waves the
          round released, or still holds as the latest plan. */}
      <div className={styles.wavesBody}>
        {Array.from({ length: Math.ceil(probes.length / waveSize) }, (_, w) => (
          <Flexbox horizontal align={'center'} data-reopened-row={w} gap={8} key={`reopened-${w}`}>
            <span className={styles.rowLabel}>{t('goalBatch.redispatch.reopenedRow')}</span>
            <Flexbox horizontal gap={BATCH_SQUARE_GAP}>
              {probes.slice(w * waveSize, (w + 1) * waveSize).map((probe) => (
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
        <WaveRows rows={rows} onSelect={onSelect} />
      </div>
    </GroupShell>
  );
});

BatchRedispatchGroup.displayName = 'GoalBatchRedispatchGroup';
