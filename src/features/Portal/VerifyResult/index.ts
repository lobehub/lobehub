import { type PortalImpl } from '../type';
import Body from './Body';
import Title from './Title';
import { useVerifyResultMoreMenu } from './useMoreMenu';

export const VerifyResult: PortalImpl = {
  Body,
  Title,
  useMoreMenu: useVerifyResultMoreMenu,
};
