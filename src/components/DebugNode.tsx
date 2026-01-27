'use client';

import { type ReactNode, useEffect } from 'react';

interface DebugNodeProps {
  children?: ReactNode;
  trace: string;
}

const DebugNode = ({ children, trace }: DebugNodeProps) => {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    // eslint-disable-next-line no-console
    console.log(`[DebugNode] Suspense fallback active: ${trace}`);
  }, [trace]);

  return children ?? null;
};

export default DebugNode;
