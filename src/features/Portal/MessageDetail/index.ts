import { type PortalImpl } from '../type';
import Body from './Body';
import Title from './Title';
import { useMessageDetailMoreMenu } from './useMoreMenu';

export const MessageDetail: PortalImpl = {
  Body,
  Title,
  useMoreMenu: useMessageDetailMoreMenu,
};
