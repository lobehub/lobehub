import { type PortalImpl } from '../type';
import Chat from './Chat';
import Header from './Header';
import { useTopicMoreMenu } from './useMoreMenu';

export const Topic: PortalImpl = {
  Body: Chat,
  Header,
  Title: () => null,
  useMoreMenu: useTopicMoreMenu,
};
