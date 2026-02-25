import type { DropdownMenuProps, PopoverProps } from '@lobehub/ui';
import { createContext, useContext, useMemo } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';

export const OverlayContainerContext = createContext<HTMLDivElement | null>(null);

interface OverlayPopoverPortalProps extends NonNullable<PopoverProps['portalProps']> {
  container?: HTMLElement | null;
}

export const useOverlayContainer = () => {
  return useContext(OverlayContainerContext);
};

const useMobileOverlayContainer = () => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  const container = useOverlayContainer();

  return useMemo(() => {
    if (!mobile || !container) return undefined;

    return container;
  }, [container, mobile]);
};

export const useOverlayDropdownPortalProps = (): DropdownMenuProps['portalProps'] => {
  const container = useMobileOverlayContainer();

  return useMemo(() => {
    if (!container) return undefined;

    return { container };
  }, [container]);
};

export const useOverlayPopoverPortalProps = (): OverlayPopoverPortalProps | undefined => {
  const container = useMobileOverlayContainer();

  return useMemo(() => {
    if (!container) return undefined;

    return { container };
  }, [container]);
};
