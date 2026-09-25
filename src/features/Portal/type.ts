import { type FC, type PropsWithChildren } from 'react';

export interface PortalImpl {
  Body: FC;
  Header?: FC<{ onClose?: () => void }>;
  Title: FC;
  Wrapper?: FC<PropsWithChildren>;
}
