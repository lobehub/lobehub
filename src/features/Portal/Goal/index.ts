import { type PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { useGoalMoreMenu } from './useMoreMenu';

export const Goal: PortalImpl = { Body, Header, Title, useMoreMenu: useGoalMoreMenu };
