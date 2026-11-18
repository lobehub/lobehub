import { type ReactNode } from 'react';

const grid = {
  display: 'grid',
  gap: '8px 16px',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, max(280px, 45%)), 1fr))',
};

export const CatalogGrid = ({ children }: { children: ReactNode }) => (
  <div style={grid}>{children}</div>
);
