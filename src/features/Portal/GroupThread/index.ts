import { type PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { useGroupThreadMoreMenu } from './useMoreMenu';

export const GroupThread: PortalImpl = {
  Body,
  Header,
  Title,
  useMoreMenu: useGroupThreadMoreMenu,
};
