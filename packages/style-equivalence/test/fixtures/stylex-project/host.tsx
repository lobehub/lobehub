import type { ReactNode } from 'react';

export const Host = ({ children }: { children: ReactNode }) => (
  <div style={{ fontFamily: 'Arial, sans-serif' }}>{children}</div>
);
