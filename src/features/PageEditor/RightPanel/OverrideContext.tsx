'use client';

import { createContext, type ReactNode, use, useMemo, useState } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

interface PageAgentPanelOverrideValue {
  expand: boolean;
  setExpand: (next: boolean) => void;
}

const PageAgentPanelOverrideContext = createContext<PageAgentPanelOverrideValue | null>(null);

export const usePageAgentPanelOverride = (): PageAgentPanelOverrideValue | null =>
  use(PageAgentPanelOverrideContext);

interface PageAgentPanelOverrideProviderProps {
  children: ReactNode;
  defaultExpand?: boolean;
}

/**
 * Replace the persisted global `showPageAgentPanel` with ephemeral local
 * state. Use when PageEditor renders inside a transient surface (e.g. modal),
 * so toggling the right panel doesn't change the user's global preference.
 */
export const PageAgentPanelOverrideProvider = ({
  children,
  defaultExpand = false,
}: PageAgentPanelOverrideProviderProps) => {
  const [expand, setExpand] = useState(defaultExpand);
  const value = useMemo(() => ({ expand, setExpand }), [expand]);
  return <PageAgentPanelOverrideContext value={value}>{children}</PageAgentPanelOverrideContext>;
};

interface PageAgentPanelControl {
  expand: boolean;
  toggle: (next?: boolean) => void;
}

/**
 * Read + toggle the page-agent panel. Resolves to override state when an
 * `OverrideProvider` is mounted above; otherwise falls through to the global
 * persisted preference. Always use this instead of reading
 * `showPageAgentPanel` directly inside the PageEditor surface.
 */
export const usePageAgentPanelControl = (): PageAgentPanelControl => {
  const override = usePageAgentPanelOverride();
  const globalExpand = useGlobalStore(systemStatusSelectors.showPageAgentPanel);
  const globalToggle = useGlobalStore((s) => s.togglePageAgentPanel);

  if (override) {
    return {
      expand: override.expand,
      toggle: (next) => {
        const value = typeof next === 'boolean' ? next : !override.expand;
        override.setExpand(value);
      },
    };
  }

  return { expand: !!globalExpand, toggle: globalToggle };
};
