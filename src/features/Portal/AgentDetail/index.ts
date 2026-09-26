import type { PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { useAgentDetailMoreMenu } from './useMoreMenu';

export const AgentDetail: PortalImpl = {
  Body,
  Header,
  Title,
  useMoreMenu: useAgentDetailMoreMenu,
};
