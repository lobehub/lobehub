import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  // Cards carry their own frame, so the grid sits bare in its host. The page
  // is full width, so columns step by the host's own width — one on a phone,
  // then two, three and four — keeping every card at least ~270px wide.
  grid: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'minmax(0, 1fr)',
      '@container device-grid (min-width: 560px)': 'repeat(2, minmax(0, 1fr))',
      '@container device-grid (min-width: 880px)': 'repeat(3, minmax(0, 1fr))',
      '@container device-grid (min-width: 1200px)': 'repeat(4, minmax(0, 1fr))',
    },
    gap: '16px',
    minWidth: 0,
  },
  // Query container for the grid's column steps (a grid can't query itself).
  host: { containerName: 'device-grid', containerType: 'inline-size', minWidth: 0 },
});

interface DeviceGridProps {
  children: ReactNode;
  className?: string;
}

/**
 * The device card grid — shared by the loaded list and its skeleton, so the
 * loading → loaded swap keeps every card in place.
 */
const DeviceGrid = ({ children, className }: DeviceGridProps) => (
  <div {...stylex.props(styles.host)}>
    <div {...sx([styles.grid], className)}>{children}</div>
  </div>
);

export default DeviceGrid;
