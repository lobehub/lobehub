'use client';

import type { PropsWithChildren } from 'react';

import { usePrePaintSignal } from './usePrePaintSignal';

/** Renders the app tree at once and reports its first paint (see `usePrePaintSignal`). */
const PrePaintSignal = ({ children }: PropsWithChildren) => {
  usePrePaintSignal();

  return <>{children}</>;
};

export default PrePaintSignal;
