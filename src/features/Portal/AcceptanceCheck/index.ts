import type { PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { useAcceptanceCheckMoreMenu } from './useMoreMenu';

export const AcceptanceCheck: PortalImpl = {
  Body,
  Header,
  Title,
  useMoreMenu: useAcceptanceCheckMoreMenu,
};
