import { type PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { useFilePreviewMoreMenu } from './useMoreMenu';

export const FilePreview: PortalImpl = {
  Body,
  Header,
  Title,
  useMoreMenu: useFilePreviewMoreMenu,
};
