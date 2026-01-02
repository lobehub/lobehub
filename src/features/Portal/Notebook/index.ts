import { type PortalImpl } from '../type';
import Body from './Body';
import Title from './Title';
import { useEnable } from './useEnable';

export const Notebook: PortalImpl = {
  Body,
  Title,
  useEnable,
};
