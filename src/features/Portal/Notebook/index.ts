import { type PortalImpl } from '../type';
import Body from './Body';
import Title from './Title';
import { useNotebookMoreMenu } from './useMoreMenu';

export const Notebook: PortalImpl = {
  Body,
  Title,
  useMoreMenu: useNotebookMoreMenu,
};
