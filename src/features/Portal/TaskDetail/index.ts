import { type PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { useTaskDetailMoreMenu } from './useMoreMenu';

export const TaskDetail: PortalImpl = { Body, Header, Title, useMoreMenu: useTaskDetailMoreMenu };
