'use client';

import { createContext, memo, type ReactNode, use, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

interface HeaderSlotContextValue {
  el: HTMLElement | null;
  setEl: (el: HTMLElement | null) => void;
}

const HeaderSlotContext = createContext<HeaderSlotContextValue>({
  el: null,
  setEl: () => {},
});

const Provider = memo<{ children: ReactNode }>(({ children }) => {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const value = useMemo<HeaderSlotContextValue>(() => ({ el, setEl }), [el]);
  return <HeaderSlotContext value={value}>{children}</HeaderSlotContext>;
});

Provider.displayName = 'HeaderSlotProvider';

const Outlet = memo(() => {
  const { setEl } = use(HeaderSlotContext);
  return <span ref={setEl} />;
});

Outlet.displayName = 'HeaderSlotOutlet';

const HeaderSlot = memo<{ children: ReactNode }>(({ children }) => {
  const { el } = use(HeaderSlotContext);
  if (!el) return null;
  return createPortal(children, el);
});

HeaderSlot.displayName = 'HeaderSlot';

export default Object.assign(HeaderSlot, { Outlet, Provider });
