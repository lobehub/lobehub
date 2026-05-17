'use client';

import { type ReactNode } from 'react';
import { useEffect } from 'react';

interface DebugNodeProps {
  children?: ReactNode;
  trace: string;
}

const DebugNode = ({ children, trace }: DebugNodeProps) => {
  if (!__DEV__) return null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    console.info(`[DebugNode] Suspense fallback active: ${trace}`);
  }, [trace]);

  return children ?? null;
};

export default DebugNode;
