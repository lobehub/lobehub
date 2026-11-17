'use client';

import {
  createContext,
  type CSSProperties,
  memo,
  type ReactNode,
  type RefCallback,
  use,
  useCallback,
  useMemo,
  useState,
} from 'react';
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

// The conversation's scroller runs underneath the slot, so the slot paints
// above it and lets pointer input through everywhere except the card itself.
const outletStyle: CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  pointerEvents: 'none',
  position: 'relative',
  zIndex: 1,
};

interface OutletProps {
  /** Also attached to the slot element, e.g. to observe its animated width. */
  slotRef?: RefCallback<HTMLDivElement>;
}

const Outlet = ({ slotRef }: OutletProps) => {
  const { setEl } = use(OverviewSlotContext);
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      setEl(node);
      const detachSlotRef = slotRef?.(node);
      return () => {
        if (typeof detachSlotRef === 'function') detachSlotRef();
        setEl(null);
      };
    },
    [setEl, slotRef],
  );

  return <div ref={ref} style={outletStyle} />;
};

const OverviewSlot = memo<{ children: ReactNode }>(({ children }) => {
  const { el } = use(OverviewSlotContext);
  if (!el) return children;
  return createPortal(children, el);
});

OverviewSlot.displayName = 'OverviewSlot';

export default Object.assign(OverviewSlot, { Outlet, Provider });
