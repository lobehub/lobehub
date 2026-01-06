import { type PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { onClose, useEnable } from './hook';

export const GroupThread: PortalImpl = {
  Body,
  Header,
  Title,
  onClose,
  useEnable,
};
