import { type PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import PortalHeader from './PortalHeader';
import { useDocumentMoreMenu } from './useMoreMenu';
import Wrapper from './Wrapper';

export const Document: PortalImpl = {
  Body,
  Header: PortalHeader,
  Title: Header,
  useMoreMenu: useDocumentMoreMenu,
  Wrapper,
};
