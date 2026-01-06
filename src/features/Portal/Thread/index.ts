import { type PortalImpl } from '../type';
import Chat from './Chat';
import Header from './Header';
import { onClose, useEnable } from './hook';

export const Thread: PortalImpl = {
  Body: Chat,
  Header,
  Title: () => null,
  onClose,
  useEnable,
};
