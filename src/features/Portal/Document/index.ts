import { type PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import { useEnable } from './useEnable';
import Wrapper from './Wrapper';

export const Document: PortalImpl = {
  Body,
  Title: Header,
  Wrapper,
  useEnable,
};
