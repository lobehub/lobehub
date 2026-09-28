import { type PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { useTaskResultMoreMenu } from './useMoreMenu';

export const TaskResult: PortalImpl = { Body, Header, Title, useMoreMenu: useTaskResultMoreMenu };
