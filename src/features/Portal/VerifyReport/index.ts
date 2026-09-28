import type { PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { useVerifyReportMoreMenu } from './useMoreMenu';

export const VerifyReport: PortalImpl = {
  Body,
  Header,
  Title,
  useMoreMenu: useVerifyReportMoreMenu,
};
