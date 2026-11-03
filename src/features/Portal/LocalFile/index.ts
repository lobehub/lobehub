import { type PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { useLocalFileMoreMenu } from './useMoreMenu';

export const LocalFile: PortalImpl = {
  Body,
  Header,
  Title,
  useMoreMenu: useLocalFileMoreMenu,
};
