import { type FC, type PropsWithChildren } from 'react';

import { type UsePortalMoreMenu } from './components/PortalMoreMenu/types';

export interface PortalImpl {
  Body: FC;
  Header?: FC<{ onClose?: () => void }>;
  Title: FC;
  /**
   * Capabilities for the shared `…` menu after the title. Called inside the
   * view's Wrapper; unsupported capabilities are left out and never shown.
   */
  useMoreMenu?: UsePortalMoreMenu;
  Wrapper?: FC<PropsWithChildren>;
}
