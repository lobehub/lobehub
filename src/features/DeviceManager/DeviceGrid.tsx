import { createStaticStyles, cx } from '@lobehub/ui';
import type { ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  // Cards carry their own frame, so the grid sits bare in its host. The page
  // is full width, so columns step by the host's own width — one on a phone,
  // then two, three and four — keeping every card at least ~270px wide.
  grid: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    min-width: 0;

    @container device-grid (min-width: 560px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @container device-grid (min-width: 880px) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    @container device-grid (min-width: 1200px) {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  `,
  // Query container for the grid's column steps (a grid can't query itself).
  host: css`
    container: device-grid / inline-size;
    min-width: 0;
  `,
}));

interface DeviceGridProps {
  children: ReactNode;
  className?: string;
}

/**
 * The device card grid — shared by the loaded list and its skeleton, so the
 * loading → loaded swap keeps every card in place.
 */
const DeviceGrid = ({ children, className }: DeviceGridProps) => (
  <div className={styles.host}>
    <div className={cx(styles.grid, className)}>{children}</div>
  </div>
);

export default DeviceGrid;
