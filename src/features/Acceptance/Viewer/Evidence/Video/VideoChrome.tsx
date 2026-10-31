'use client';

import { useVideo } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

import { styles } from './styles';
import { isOnFrame } from './videoTime';

type Rect = { height: number; width: number; x: number; y: number };

const percent = (rect: Rect) => ({
  height: `${rect.height * 100}%`,
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.width * 100}%`,
});

/** A region drawn on a frame, shown only while that frame is on screen. */
export interface FrameRegion {
  color?: string;
  comment?: string;
  key: number | string;
  label?: number | string;
  rect: Rect;
  start: number;
}

const Regions = ({ active, regions }: { active?: string; regions: FrameRegion[] }) => {
  const time = useVideo((state) => state.time);
  const paused = useVideo((state) => state.paused);
  return regions
    .filter((region) => isOnFrame(region.start, time, paused))
    .map((region) => (
      <div
        key={region.key}
        {...sx(
          [region.label === undefined && region.color === undefined ? styles.region : styles.mark],
          undefined,
          { ...percent(region.rect), borderColor: region.color },
        )}
      >
        {region.label !== undefined ? (
          <span
            {...sx([styles.markBadge, region.key === active && styles.markBadgeActive], undefined, {
              background: region.color,
            })}
          >
            {region.label}
          </span>
        ) : region.comment ? (
          <span {...stylex.props(styles.regionLabel)}>{region.comment}</span>
        ) : null}
      </div>
    ));
};

/** Regions follow the playhead; with none, nothing subscribes to it. */
export const FrameRegions = ({ active, regions }: { active?: string; regions: FrameRegion[] }) =>
  regions.length > 0 ? <Regions active={active} regions={regions} /> : null;

export const DraftRegion = ({ rect }: { rect: Rect }) => (
  <div {...sx([styles.draft], undefined, percent(rect))} />
);
