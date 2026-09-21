'use client';

import { createContext, memo, type ReactNode, use, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

interface OverviewSlotContextValue {
  el: HTMLElement | null;
  setEl: (el: HTMLElement | null) => void;
}

const OverviewSlotContext = createContext<OverviewSlotContextValue>({
  el: null,
  setEl: () => {},
});

const Provider = memo<{ children: ReactNode }>(({ children }) => {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const value = useMemo<OverviewSlotContextValue>(() => ({ el, setEl }), [el]);
  return <OverviewSlotContext value={value}>{children}</OverviewSlotContext>;
});

Provider.displayName = 'OverviewSlotProvider';

const Outlet = () => {
  const { setEl } = use(OverviewSlotContext);
  return <div ref={setEl} style={{ display: 'contents' }} />;
};

const OverviewSlot = memo<{ children: ReactNode }>(({ children }) => {
  const { el } = use(OverviewSlotContext);
  if (!el) return children;
  return createPortal(children, el);
});

OverviewSlot.displayName = 'OverviewSlot';

export default Object.assign(OverviewSlot, { Outlet, Provider });
