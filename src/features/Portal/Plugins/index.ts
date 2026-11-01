import { type PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { useToolUIMoreMenu } from './useMoreMenu';

export const Plugins: PortalImpl = {
  Body,
  Header,
  Title,
  useMoreMenu: useToolUIMoreMenu,
};
