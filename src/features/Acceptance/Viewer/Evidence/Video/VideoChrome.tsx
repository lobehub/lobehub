'use client';

import { useVideo } from '@lobehub/ui';

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
  comment?: string;
  key: number | string;
  rect: Rect;
  start: number;
}

const Regions = ({ regions }: { regions: FrameRegion[] }) => {
  const time = useVideo((state) => state.time);
  const paused = useVideo((state) => state.paused);
  return regions
    .filter((region) => isOnFrame(region.start, time, paused))
    .map((region) => (
      <div className={styles.region} key={region.key} style={percent(region.rect)}>
        {region.comment && <span className={styles.regionLabel}>{region.comment}</span>}
      </div>
    ));
};

/** Regions follow the playhead; with none, nothing subscribes to it. */
export const FrameRegions = ({ regions }: { regions: FrameRegion[] }) =>
  regions.length > 0 ? <Regions regions={regions} /> : null;

export const DraftRegion = ({ rect }: { rect: Rect }) => (
  <div className={styles.draft} style={percent(rect)} />
);
