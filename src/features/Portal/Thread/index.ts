import type {PortalImpl} from '../type';
import Chat from './Chat';
import Header from './Header';

export const Thread: PortalImpl = {
  Body: Chat,
  Header,
  Title: () => null,
};
