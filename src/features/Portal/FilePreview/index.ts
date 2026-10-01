import { type PortalImpl } from '../type';
import Body from './Body';
import Title from './Title';
import { useFilePreviewMoreMenu } from './useMoreMenu';

export const FilePreview: PortalImpl = {
  Body,
  Title,
  useMoreMenu: useFilePreviewMoreMenu,
};
