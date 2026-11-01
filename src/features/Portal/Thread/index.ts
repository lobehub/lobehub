import { type PortalImpl } from '../type';
import Chat from './Chat';
import Header from './Header';
import { useThreadMoreMenu } from './useMoreMenu';

export const Thread: PortalImpl = {
  Body: Chat,
  Header,
  Title: () => null,
  useMoreMenu: useThreadMoreMenu,
};
