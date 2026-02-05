import type {PortalImpl} from '../type';
import Body from './Body';
import Header from './Header';
import Wrapper from './Wrapper';

export const Document: PortalImpl = {
  Body,
  Title: Header,
  Wrapper,
};
